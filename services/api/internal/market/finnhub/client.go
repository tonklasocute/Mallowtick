// Package finnhub implements market.Provider against the Finnhub REST API
// (https://finnhub.io/docs/api) for quotes, symbol search, the earnings
// calendar and company fundamentals. The free plan allows 60 calls a minute
// but has no historical candles (verified: /stock/candle answers 403), so it
// is used together with a candle vendor through market.Composite.
package finnhub

import (
	"cmp"
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

	"github.com/tonklasocute/mallowtick/services/api/internal/cache"
	"github.com/tonklasocute/mallowtick/services/api/internal/market"
	"github.com/tonklasocute/mallowtick/services/api/internal/ratebudget"
)

// ProviderName identifies this adapter in responses and logs.
const ProviderName = "finnhub"

const (
	maxBodyBytes = 4 << 20
	// infoTTL keeps company names, exchanges and 52-week ranges, which change
	// rarely, so a quote costs one call once they are known.
	infoTTL = 24 * time.Hour
)

// Config configures the client.
type Config struct {
	APIKey  string
	BaseURL string
	// CallsPerMinute is the plan's allowance (free plan: 60).
	CallsPerMinute int
	// MaxWait bounds how long a call waits for room before failing with
	// market.ErrRateLimited.
	MaxWait    time.Duration
	HTTPClient *http.Client
	Logger     *slog.Logger
	Now        func() time.Time
}

// Client is a concurrency-safe Finnhub adapter.
type Client struct {
	apiKey  string
	baseURL *url.URL
	http    *http.Client
	budget  *ratebudget.Budget
	maxWait time.Duration
	log     *slog.Logger
	now     func() time.Time

	info   *cache.TTL[instrumentInfo]
	ranges *cache.TTL[market.Range52]
	// logos holds the logo URL per symbol, including "" for symbols without one,
	// so search results can show logos without fetching whole profiles twice.
	logos *cache.TTL[string]
	// searchSlot lets one /search call run at a time. Finnhub answers 429 to a
	// burst of searches well inside the per-minute allowance (checked 2026-10-27:
	// 6 at once gave 2 × 429, 6 in a row none), and a 429 marks the whole budget spent.
	searchSlot chan struct{}
}

var (
	_ market.Provider             = (*Client)(nil)
	_ market.EarningsProvider     = (*Client)(nil)
	_ market.RangeProvider        = (*Client)(nil)
	_ market.FundamentalsProvider = (*Client)(nil)
	_ market.PerformanceProvider  = (*Client)(nil)
)

// New validates cfg and returns a client.
func New(cfg Config) (*Client, error) {
	if strings.TrimSpace(cfg.APIKey) == "" {
		return nil, errors.New("finnhub: API key is required")
	}
	base, err := url.Parse(strings.TrimRight(cfg.BaseURL, "/"))
	if err != nil || base.Scheme == "" || base.Host == "" {
		return nil, fmt.Errorf("finnhub: invalid base URL %q", cfg.BaseURL)
	}
	if cfg.CallsPerMinute < 1 {
		return nil, errors.New("finnhub: calls per minute must be >= 1")
	}
	if cfg.HTTPClient == nil {
		cfg.HTTPClient = &http.Client{Timeout: 10 * time.Second}
	}
	if cfg.Logger == nil {
		cfg.Logger = slog.New(slog.DiscardHandler)
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	return &Client{
		apiKey:  cfg.APIKey,
		baseURL: base,
		http:    cfg.HTTPClient,
		budget:  ratebudget.New(cfg.CallsPerMinute, time.Minute),
		maxWait: cfg.MaxWait,
		log:     cfg.Logger,
		now:     cfg.Now,
		info:    cache.New[instrumentInfo](infoTTL, infoTTL, 5000, cfg.Now),
		ranges:  cache.New[market.Range52](infoTTL, infoTTL, 5000, cfg.Now),
		logos:   cache.New[string](infoTTL, infoTTL, 5000, cfg.Now),

		searchSlot: make(chan struct{}, 1),
	}, nil
}

func (c *Client) Name() string     { return ProviderName }
func (c *Client) Configured() bool { return true }

// get spends one call from the budget, performs a GET, and decodes the JSON
// body into out.
func (c *Client) get(ctx context.Context, path string, params url.Values, out any) error {
	if err := c.budget.Spend(ctx, 1, c.maxWait); err != nil {
		if errors.Is(err, ratebudget.ErrNoRoom) {
			return fmt.Errorf("%w: %w", market.ErrRateLimited, err)
		}
		return err
	}

	u := c.baseURL.JoinPath(path)
	u.RawQuery = params.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return fmt.Errorf("%w: build request: %w", market.ErrUnavailable, err)
	}
	req.Header.Set("X-Finnhub-Token", c.apiKey)
	req.Header.Set("Accept", "application/json")

	start := time.Now()
	resp, err := c.http.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return fmt.Errorf("%w: %s request failed: %w", market.ErrUnavailable, path, err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBodyBytes))
	c.log.LogAttrs(ctx, slog.LevelDebug, "finnhub request",
		slog.String("path", path), slog.Int("status", resp.StatusCode), slog.Duration("duration", time.Since(start)))
	if err != nil {
		return fmt.Errorf("%w: read %s response: %w", market.ErrUnavailable, path, err)
	}
	if resp.StatusCode >= 300 {
		var e struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(body, &e)
		err := mapError(resp.StatusCode, cmp.Or(e.Error, http.StatusText(resp.StatusCode)))
		if errors.Is(err, market.ErrRateLimited) {
			c.budget.Exhaust() // stop sending calls the provider would refuse
		}
		return err
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("%w: decode %s: %w", market.ErrUnavailable, path, err)
	}
	return nil
}

func mapError(code int, message string) error {
	var sentinel error
	switch code {
	case http.StatusUnauthorized:
		sentinel = market.ErrUnauthorized
	case http.StatusForbidden:
		sentinel = market.ErrNotEntitled
	case http.StatusNotFound:
		sentinel = market.ErrNotFound
	case http.StatusTooManyRequests:
		sentinel = market.ErrRateLimited
	default:
		sentinel = market.ErrUnavailable
	}
	return fmt.Errorf("%w (finnhub %d: %s)", sentinel, code, message)
}
