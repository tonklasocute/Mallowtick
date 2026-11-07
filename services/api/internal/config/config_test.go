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
	// A chart waiting longer than a few seconds for credits only looks frozen.
	if cfg.TwelveData.MaxWait != 3*time.Second || cfg.RequestTimeout <= cfg.TwelveData.MaxWait {
		t.Fatalf("twelve data max wait = %s, request timeout = %s", cfg.TwelveData.MaxWait, cfg.RequestTimeout)
	}
	if len(cfg.Market.OverviewSymbols) != 3 || len(cfg.Market.PopularSymbols) != 0 {
		t.Fatalf("popular symbols must be opt-in: %+v", cfg.Market)
	}
	if len(cfg.CORSOrigins) != 1 || cfg.CORSOrigins[0] != "http://localhost:3000" {
		t.Fatalf("cors = %v", cfg.CORSOrigins)
	}
	if cfg.Market.CacheFile != "" {
		t.Fatalf("the cache file must be opt-in, got %q", cfg.Market.CacheFile)
	}
	want := Clients{RequestsPerMinute: 120, TwelveDataPerDay: 200, FinnhubPerMinute: 45}
	if c := cfg.Clients; c.RequestsPerMinute != want.RequestsPerMinute || c.TwelveDataPerDay != want.TwelveDataPerDay ||
		c.FinnhubPerMinute != want.FinnhubPerMinute || strings.Join(c.TrustedProxies, ",") != "127.0.0.1,::1" {
		t.Fatalf("client limits = %+v", c)
	}
}

func TestClientLimitOverrides(t *testing.T) {
	cfg, err := Load(env(map[string]string{
		"CLIENT_REQUESTS_PER_MINUTE":        "0",
		"CLIENT_TWELVEDATA_CREDITS_PER_DAY": "50",
		"TRUSTED_PROXIES":                   "172.18.0.0/16, 10.0.0.2",
	}))
	if err != nil {
		t.Fatal(err)
	}
	c := cfg.Clients
	if c.RequestsPerMinute != 0 || c.TwelveDataPerDay != 50 || c.FinnhubPerMinute != 45 ||
		strings.Join(c.TrustedProxies, ",") != "172.18.0.0/16,10.0.0.2" {
		t.Fatalf("client limits = %+v", c)
	}
	cfg, err = Load(env(map[string]string{"TRUSTED_PROXIES": "none"}))
	if err != nil || cfg.Clients.TrustedProxies != nil {
		t.Fatalf("none trusts no proxy: %v %v", cfg.Clients.TrustedProxies, err)
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
		"CACHE_FILE":              " ./.cache/market-cache.json ",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Market.CacheFile != "./.cache/market-cache.json" {
		t.Fatalf("cache file = %q", cfg.Market.CacheFile)
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

func TestRequestTimeoutMustExceedTwelveDataWait(t *testing.T) {
	cfg, err := Load(env(map[string]string{"TWELVEDATA_MAX_WAIT": "10s"}))
	if err != nil || cfg.TwelveData.MaxWait != 10*time.Second {
		t.Fatalf("a longer wait is still allowed: %v %v", cfg.TwelveData.MaxWait, err)
	}
	_, err = Load(env(map[string]string{"TWELVEDATA_MAX_WAIT": "15s"}))
	if err == nil || !strings.Contains(err.Error(), "API_REQUEST_TIMEOUT must exceed TWELVEDATA_MAX_WAIT") {
		t.Fatalf("expected the timeout check, got %v", err)
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
		"CLIENT_REQUESTS_PER_MINUTE":    "-1",
		"TRUSTED_PROXIES":               "proxy.local",
	}))
	if err == nil {
		t.Fatal("expected an error")
	}
	for _, key := range []string{"API_ADDR", "QUOTE_CACHE_TTL", "TWELVEDATA_CREDITS_PER_MINUTE", "MARKET_DATA_LATENCY",
		"POPULAR_SYMBOLS", "API_CORS_ORIGINS", "LOG_LEVEL", "CLIENT_REQUESTS_PER_MINUTE", "TRUSTED_PROXIES"} {
		if !strings.Contains(err.Error(), key) {
			t.Errorf("error should mention %s:\n%v", key, err)
		}
	}
}
