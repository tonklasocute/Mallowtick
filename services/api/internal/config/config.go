// Package config loads and validates API server configuration from the
// environment. Every problem is reported at startup rather than at first use.
package config

import (
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/tonklasocute/mallowtick/services/api/internal/market"
)

// Config is the validated server configuration.
type Config struct {
	Env             string
	Addr            string
	CORSOrigins     []string
	LogLevel        slog.Level
	LogFormat       string
	RequestTimeout  time.Duration
	ShutdownTimeout time.Duration
	TwelveData      TwelveData
	Market          Market
}

// TwelveData configures the Twelve Data adapter. An empty APIKey leaves the
// provider unconfigured; the server still starts and reports that state.
type TwelveData struct {
	APIKey           string
	BaseURL          string
	CreditsPerMinute int
	MaxWait          time.Duration
	Timeout          time.Duration
}

// Market configures caching, freshness labelling, and curated symbol lists.
type Market struct {
	Latency         market.Latency
	QuoteTTL        time.Duration
	QuoteTTLClosed  time.Duration
	StaleRetention  time.Duration
	OverviewSymbols []market.Symbol
	PopularSymbols  []market.Symbol
}

// LookupFunc matches os.LookupEnv.
type LookupFunc func(string) (string, bool)

type loader struct {
	lookup LookupFunc
	errs   []error
}

func (l *loader) str(key, def string) string {
	if v, ok := l.lookup(key); ok && strings.TrimSpace(v) != "" {
		return strings.TrimSpace(v)
	}
	return def
}

func (l *loader) duration(key string, def time.Duration) time.Duration {
	raw := l.str(key, "")
	if raw == "" {
		return def
	}
	d, err := time.ParseDuration(raw)
	if err != nil || d <= 0 {
		l.errs = append(l.errs, fmt.Errorf("%s: %q is not a positive duration (e.g. 60s, 5m)", key, raw))
		return def
	}
	return d
}

func (l *loader) positiveInt(key string, def int) int {
	raw := l.str(key, "")
	if raw == "" {
		return def
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 1 {
		l.errs = append(l.errs, fmt.Errorf("%s: %q is not a positive integer", key, raw))
		return def
	}
	return n
}

func (l *loader) symbols(key, def string) []market.Symbol {
	raw := l.str(key, def)
	if strings.EqualFold(raw, "none") || raw == "" {
		return nil
	}
	syms, err := market.ParseSymbolList(raw)
	if err != nil {
		l.errs = append(l.errs, fmt.Errorf("%s: %w", key, err))
	}
	return syms
}

// Load reads configuration using lookup (normally os.LookupEnv).
func Load(lookup LookupFunc) (Config, error) {
	l := &loader{lookup: lookup}
	cfg := Config{
		Env:             l.str("APP_ENV", "development"),
		Addr:            l.str("API_ADDR", ":8080"),
		LogFormat:       l.str("LOG_FORMAT", "json"),
		RequestTimeout:  l.duration("API_REQUEST_TIMEOUT", 15*time.Second),
		ShutdownTimeout: l.duration("API_SHUTDOWN_TIMEOUT", 10*time.Second),
		TwelveData: TwelveData{
			APIKey:           l.str("TWELVEDATA_API_KEY", ""),
			BaseURL:          l.str("TWELVEDATA_BASE_URL", "https://api.twelvedata.com"),
			CreditsPerMinute: l.positiveInt("TWELVEDATA_CREDITS_PER_MINUTE", 8),
			MaxWait:          l.duration("TWELVEDATA_MAX_WAIT", 5*time.Second),
			Timeout:          l.duration("TWELVEDATA_TIMEOUT", 10*time.Second),
		},
		Market: Market{
			QuoteTTL:        l.duration("QUOTE_CACHE_TTL", 60*time.Second),
			QuoteTTLClosed:  l.duration("QUOTE_CACHE_TTL_CLOSED", 15*time.Minute),
			StaleRetention:  l.duration("STALE_RETENTION", 24*time.Hour),
			OverviewSymbols: l.symbols("MARKET_OVERVIEW_SYMBOLS", "SPY,QQQ,DIA"),
			PopularSymbols:  l.symbols("POPULAR_SYMBOLS", ""),
		},
	}

	for _, o := range strings.Split(l.str("API_CORS_ORIGINS", "http://localhost:3000"), ",") {
		o = strings.TrimRight(strings.TrimSpace(o), "/")
		if o == "" {
			continue
		}
		if u, err := url.Parse(o); err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.Path != "" {
			l.errs = append(l.errs, fmt.Errorf("API_CORS_ORIGINS: %q is not an origin like https://app.example.com", o))
			continue
		}
		cfg.CORSOrigins = append(cfg.CORSOrigins, o)
	}

	if _, _, err := net.SplitHostPort(cfg.Addr); err != nil {
		l.errs = append(l.errs, fmt.Errorf("API_ADDR: %q is not host:port", cfg.Addr))
	}
	if err := cfg.LogLevel.UnmarshalText([]byte(l.str("LOG_LEVEL", "info"))); err != nil {
		l.errs = append(l.errs, fmt.Errorf("LOG_LEVEL: %w", err))
	}
	if cfg.LogFormat != "json" && cfg.LogFormat != "text" {
		l.errs = append(l.errs, fmt.Errorf("LOG_FORMAT: %q must be json or text", cfg.LogFormat))
	}
	if u, err := url.Parse(cfg.TwelveData.BaseURL); err != nil || u.Scheme != "https" && u.Scheme != "http" || u.Host == "" {
		l.errs = append(l.errs, fmt.Errorf("TWELVEDATA_BASE_URL: %q is not an http(s) URL", cfg.TwelveData.BaseURL))
	}
	latency, ok := market.ParseLatency(l.str("MARKET_DATA_LATENCY", string(market.LatencyUnknown)))
	if !ok {
		l.errs = append(l.errs, errors.New("MARKET_DATA_LATENCY: must be realtime, delayed, eod or unknown"))
	}
	cfg.Market.Latency = latency
	if cfg.Market.StaleRetention < cfg.Market.QuoteTTLClosed {
		l.errs = append(l.errs, errors.New("STALE_RETENTION must be at least QUOTE_CACHE_TTL_CLOSED"))
	}
	if cfg.RequestTimeout <= cfg.TwelveData.MaxWait {
		l.errs = append(l.errs, errors.New("API_REQUEST_TIMEOUT must exceed TWELVEDATA_MAX_WAIT"))
	}

	if err := errors.Join(l.errs...); err != nil {
		return Config{}, fmt.Errorf("invalid configuration:\n%w", err)
	}
	return cfg, nil
}

// ProviderConfigured reports whether market-data credentials are present.
func (c Config) ProviderConfigured() bool { return c.TwelveData.APIKey != "" }
