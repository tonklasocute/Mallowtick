package config

import (
	"strings"
	"testing"
	"time"

	"github.com/tonklasocute/mallowtick/services/api/internal/market"
)

func env(m map[string]string) LookupFunc {
	return func(k string) (string, bool) {
		v, ok := m[k]
		return v, ok
	}
}

func TestDefaults(t *testing.T) {
	cfg, err := Load(env(nil))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Addr != ":8080" || cfg.ProviderConfigured() || cfg.TwelveData.CreditsPerMinute != 8 {
		t.Fatalf("unexpected defaults %+v", cfg)
	}
	if cfg.Market.Latency != market.LatencyUnknown {
		t.Fatalf("latency must default to unknown, got %s", cfg.Market.Latency)
	}
	if len(cfg.Market.OverviewSymbols) != 3 || len(cfg.Market.PopularSymbols) != 0 {
		t.Fatalf("popular symbols must be opt-in: %+v", cfg.Market)
	}
	if len(cfg.CORSOrigins) != 1 || cfg.CORSOrigins[0] != "http://localhost:3000" {
		t.Fatalf("cors = %v", cfg.CORSOrigins)
	}
}

func TestOverrides(t *testing.T) {
	cfg, err := Load(env(map[string]string{
		"TWELVEDATA_API_KEY":      "secret",
		"MARKET_DATA_LATENCY":     "realtime",
		"QUOTE_CACHE_TTL":         "2m",
		"POPULAR_SYMBOLS":         "aapl, nvda",
		"MARKET_OVERVIEW_SYMBOLS": "none",
		"API_CORS_ORIGINS":        "https://mallowtick.example.com/, http://localhost:3000",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.ProviderConfigured() || cfg.Market.Latency != market.LatencyRealtime || cfg.Market.QuoteTTL != 2*time.Minute {
		t.Fatalf("unexpected %+v", cfg)
	}
	if len(cfg.Market.OverviewSymbols) != 0 || len(cfg.Market.PopularSymbols) != 2 || cfg.Market.PopularSymbols[1] != "NVDA" {
		t.Fatalf("unexpected symbols %+v", cfg.Market)
	}
	if cfg.CORSOrigins[0] != "https://mallowtick.example.com" {
		t.Fatalf("trailing slash should be trimmed: %v", cfg.CORSOrigins)
	}
}

func TestReportsAllInvalidValues(t *testing.T) {
	_, err := Load(env(map[string]string{
		"API_ADDR":                      "8080",
		"QUOTE_CACHE_TTL":               "soon",
		"TWELVEDATA_CREDITS_PER_MINUTE": "0",
		"MARKET_DATA_LATENCY":           "live",
		"POPULAR_SYMBOLS":               "AAPL,???",
		"API_CORS_ORIGINS":              "*",
		"LOG_LEVEL":                     "loud",
	}))
	if err == nil {
		t.Fatal("expected an error")
	}
	for _, key := range []string{"API_ADDR", "QUOTE_CACHE_TTL", "TWELVEDATA_CREDITS_PER_MINUTE", "MARKET_DATA_LATENCY", "POPULAR_SYMBOLS", "API_CORS_ORIGINS", "LOG_LEVEL"} {
		if !strings.Contains(err.Error(), key) {
			t.Errorf("error should mention %s:\n%v", key, err)
		}
	}
}
