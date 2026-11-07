package httptransport

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/tonklasocute/mallowtick/services/api/internal/clientlimit"
	"github.com/tonklasocute/mallowtick/services/api/internal/market"
)

// spendingService spends one Twelve Data credit from the client's allowance
// on every quote, as a cache miss would.
type spendingService struct{ stubService }

func (s *spendingService) Quote(ctx context.Context, sym market.Symbol) (market.QuoteResult, error) {
	if err := market.TakeAllowance(ctx, "twelvedata", 1); err != nil {
		return market.QuoteResult{}, err
	}
	return s.stubService.Quote(ctx, sym)
}

// limitedRouter serves with limits, trusting 10.0.0.1 (the web app's proxy).
func limitedRouter(svc MarketService, cfg clientlimit.Config) http.Handler {
	return NewRouter(Options{
		Service: svc, Logger: slog.New(slog.DiscardHandler), RequestTimeout: time.Second,
		Limiter: clientlimit.New(cfg), TrustedProxies: []string{"10.0.0.1"},
	})
}

// call sends GET target from remote, with X-Forwarded-For when xff is set.
func call(h http.Handler, target, remote, xff string) (*httptest.ResponseRecorder, envelope) {
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, target, nil)
	req.RemoteAddr = remote + ":5000"
	if xff != "" {
		req.Header.Set("X-Forwarded-For", xff)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var env envelope
	_ = json.Unmarshal(rec.Body.Bytes(), &env)
	return rec, env
}

func TestRequestLimitPerClient(t *testing.T) {
	h := limitedRouter(&stubService{}, clientlimit.Config{RequestsPerMinute: 2})
	for range 2 {
		if rec, _ := call(h, "/api/v1/market/status", "10.0.0.1", "203.0.113.7"); rec.Code != http.StatusOK {
			t.Fatalf("within the limit: status %d", rec.Code)
		}
	}
	rec, env := call(h, "/api/v1/market/status", "10.0.0.1", "203.0.113.7")
	if rec.Code != http.StatusTooManyRequests || env.Error == nil || env.Error.Code != "too_many_requests" {
		t.Fatalf("over the limit: %d %s", rec.Code, rec.Body)
	}
	if rec.Header().Get("Retry-After") != "30" {
		t.Errorf("Retry-After = %q, want 30 (one request refills every 30 s)", rec.Header().Get("Retry-After"))
	}
	if rec, _ := call(h, "/api/v1/market/status", "10.0.0.1", "203.0.113.8"); rec.Code != http.StatusOK {
		t.Errorf("another client behind the same proxy has its own limit: %d", rec.Code)
	}
	if rec, _ := call(h, "/api/v1/health", "10.0.0.1", "203.0.113.7"); rec.Code != http.StatusOK {
		t.Errorf("health checks are never limited: %d", rec.Code)
	}
}

func TestOnlyTrustedProxiesNameTheClient(t *testing.T) {
	h := limitedRouter(&stubService{}, clientlimit.Config{RequestsPerMinute: 1})
	// A client connecting directly can't pick a new address per request.
	if rec, _ := call(h, "/api/v1/market/status", "198.51.100.4", "203.0.113.1"); rec.Code != http.StatusOK {
		t.Fatalf("first request: %d", rec.Code)
	}
	if rec, _ := call(h, "/api/v1/market/status", "198.51.100.4", "203.0.113.2"); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("X-Forwarded-For from an untrusted peer must be ignored: %d", rec.Code)
	}
	// Behind the proxy, a forged entry before the one the proxy added changes nothing.
	if rec, _ := call(h, "/api/v1/market/status", "10.0.0.1", "192.0.2.1, 203.0.113.9"); rec.Code != http.StatusOK {
		t.Fatalf("first request through the proxy: %d", rec.Code)
	}
	if rec, _ := call(h, "/api/v1/market/status", "10.0.0.1", "192.0.2.2, 203.0.113.9"); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("the client is the last address the trusted proxy saw: %d", rec.Code)
	}
}

func TestProviderShareReachesTheService(t *testing.T) {
	h := limitedRouter(&spendingService{}, clientlimit.Config{
		Vendors: map[string]clientlimit.Rate{"twelvedata": {PerDay: 1}},
	})
	if rec, _ := call(h, "/api/v1/stocks/AAPL/quote", "10.0.0.1", "203.0.113.7"); rec.Code != http.StatusOK {
		t.Fatalf("first quote: %d %s", rec.Code, rec.Body)
	}
	rec, env := call(h, "/api/v1/stocks/AAPL/quote", "10.0.0.1", "203.0.113.7")
	if rec.Code != http.StatusTooManyRequests || env.Error == nil || env.Error.Code != "rate_limited" {
		t.Fatalf("over the client's daily share: %d %s", rec.Code, rec.Body)
	}
	if rec, _ := call(h, "/api/v1/stocks/AAPL/quote", "10.0.0.1", "203.0.113.8"); rec.Code != http.StatusOK {
		t.Errorf("another client still has its share: %d", rec.Code)
	}
}
