// Package twelvedata implements market.Provider against the Twelve Data REST
// API (https://twelvedata.com/docs). It owns everything vendor-specific:
// authentication, credit-based rate limiting, response parsing, and mapping
// vendor errors onto the market package's sentinel errors.
package twelvedata

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/tonklasocute/mallowtick/services/api/internal/market"
	"github.com/tonklasocute/mallowtick/services/api/internal/ratebudget"
)

// ProviderName identifies this adapter in responses and logs.
const ProviderName = "twelvedata"

const maxBodyBytes = 8 << 20

// Config configures the client.
type Config struct {
	APIKey  string
	BaseURL string
	// CreditsPerMinute is the plan's per-minute API credit allowance. The
	// client books credits in a sliding minute before each request, as the
	// provider counts them, so it never exceeds the plan limit.
	CreditsPerMinute int
	// MaxWait bounds how long a request waits for credits before failing with
	// market.ErrRateLimited.
	MaxWait    time.Duration
	HTTPClient *http.Client
	Logger     *slog.Logger
}

// Client is a concurrency-safe Twelve Data adapter.
type Client struct {
	apiKey  string
	baseURL *url.URL
	http    *http.Client
	budget  *ratebudget.Budget
	burst   int
	maxWait time.Duration
	log     *slog.Logger
}

var _ market.Provider = (*Client)(nil)

// New validates cfg and returns a client.
func New(cfg Config) (*Client, error) {
	if strings.TrimSpace(cfg.APIKey) == "" {
		return nil, errors.New("twelvedata: API key is required")
	}
	base, err := url.Parse(strings.TrimRight(cfg.BaseURL, "/"))
	if err != nil || base.Scheme == "" || base.Host == "" {
		return nil, fmt.Errorf("twelvedata: invalid base URL %q", cfg.BaseURL)
	}
	if cfg.CreditsPerMinute < 1 {
		return nil, errors.New("twelvedata: credits per minute must be >= 1")
	}
	if cfg.HTTPClient == nil {
		cfg.HTTPClient = &http.Client{Timeout: 10 * time.Second}
	}
	if cfg.Logger == nil {
		cfg.Logger = slog.New(slog.DiscardHandler)
	}
	return &Client{
		apiKey:  cfg.APIKey,
		baseURL: base,
		http:    cfg.HTTPClient,
		budget:  ratebudget.New(cfg.CreditsPerMinute, time.Minute),
		burst:   cfg.CreditsPerMinute,
		maxWait: cfg.MaxWait,
		log:     cfg.Logger,
	}, nil
}

func (c *Client) Name() string     { return ProviderName }
func (c *Client) Configured() bool { return true }

// apiError is Twelve Data's error body. Errors are often returned with HTTP
// 200, so every response is checked for status "error".
type apiError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Status  string `json:"status"`
}

func (e apiError) isError() bool { return e.Status == "error" }

// get spends credits, performs a GET, and returns the raw body after
// checking for an error envelope.
func (c *Client) get(ctx context.Context, path string, params url.Values, credits int) ([]byte, error) {
	if err := c.spend(ctx, credits); err != nil {
		return nil, err
	}

	u := c.baseURL.JoinPath(path)
	u.RawQuery = params.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("%w: build request: %w", market.ErrUnavailable, err)
	}
	req.Header.Set("Authorization", "apikey "+c.apiKey)
	req.Header.Set("Accept", "application/json")

	start := time.Now()
	resp, err := c.http.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, fmt.Errorf("%w: %s request failed: %w", market.ErrUnavailable, path, err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBodyBytes))
	c.log.LogAttrs(ctx, slog.LevelDebug, "twelvedata request",
		slog.String("path", path), slog.Int("credits", credits),
		slog.Int("status", resp.StatusCode), slog.Duration("duration", time.Since(start)))
	if err != nil {
		return nil, fmt.Errorf("%w: read %s response: %w", market.ErrUnavailable, path, err)
	}

	var probe apiError
	_ = json.Unmarshal(body, &probe) // a non-object body (e.g. an array) is not an error envelope
	switch {
	case probe.isError():
		err = mapError(probe.Code, probe.Message)
	case resp.StatusCode >= 300:
		err = mapError(resp.StatusCode, http.StatusText(resp.StatusCode))
	default:
		return body, nil
	}
	if errors.Is(err, market.ErrRateLimited) {
		// Stop sending requests the provider would refuse.
		c.budget.Exhaust()
	}
	return nil, err
}

// spend books credits in the per-minute budget, failing fast with
// ErrRateLimited instead of queueing requests for longer than maxWait.
func (c *Client) spend(ctx context.Context, credits int) error {
	err := c.budget.Spend(ctx, credits, c.maxWait)
	if errors.Is(err, ratebudget.ErrNoRoom) {
		return fmt.Errorf("%w: %w", market.ErrRateLimited, err)
	}
	return err
}

func mapError(code int, message string) error {
	var sentinel error
	switch {
	case code == http.StatusUnauthorized:
		sentinel = market.ErrUnauthorized
	case code == http.StatusForbidden:
		sentinel = market.ErrNotEntitled
	case code == http.StatusNotFound:
		sentinel = market.ErrNotFound
	case code == http.StatusTooManyRequests:
		sentinel = market.ErrRateLimited
	case code == http.StatusBadRequest && looksLikeNotFound(message):
		sentinel = market.ErrNotFound
	default:
		sentinel = market.ErrUnavailable
	}
	return fmt.Errorf("%w (twelvedata %d: %s)", sentinel, code, message)
}

func looksLikeNotFound(message string) bool {
	m := strings.ToLower(message)
	return strings.Contains(m, "not found") || strings.Contains(m, "no data is available") || strings.Contains(m, "invalid symbol")
}
