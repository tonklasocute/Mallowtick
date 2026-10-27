package httptransport

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/tonklasocute/mallowtick/services/api/internal/market"
)

func init() { gin.SetMode(gin.TestMode) }

// stubService returns err for every call when set, otherwise canned data.
type stubService struct {
	err        error
	lastSymbol market.Symbol
	lastRange  market.Range
	lastBatch  []market.Symbol
	panics     bool
}

func (s *stubService) ProviderInfo() market.ProviderInfo {
	return market.ProviderInfo{Name: "stub", Configured: s.err == nil, Latency: market.LatencyDelayed}
}
func (s *stubService) Search(_ context.Context, q string) ([]market.Instrument, error) {
	if s.panics {
		panic("boom")
	}
	return []market.Instrument{{Symbol: "AAPL", Name: "Apple Inc"}}, s.err
}
func (s *stubService) Instrument(_ context.Context, sym market.Symbol) (market.Instrument, error) {
	s.lastSymbol = sym
	return market.Instrument{Symbol: string(sym)}, s.err
}
func (s *stubService) Quote(_ context.Context, sym market.Symbol) (market.QuoteResult, error) {
	s.lastSymbol = sym
	if s.err != nil {
		return market.QuoteResult{}, s.err
	}
	return market.QuoteResult{Quote: market.Quote{Symbol: string(sym), Price: 189.32},
		Freshness: market.Freshness{Provider: "stub", Latency: market.LatencyDelayed}}, nil
}
func (s *stubService) Quotes(_ context.Context, syms []market.Symbol) (market.QuoteBatch, error) {
	s.lastBatch = syms
	return market.QuoteBatch{Quotes: []market.QuoteResult{}, Unavailable: []market.UnavailableSymbol{}}, s.err
}
func (s *stubService) Candles(_ context.Context, sym market.Symbol, rng market.Range) (market.CandlesResult, error) {
	s.lastSymbol, s.lastRange = sym, rng
	return market.CandlesResult{Range: rng, Warmup: []market.Candle{{Close: 1}}}, s.err
}

func TestCandlesIncludeWarmupOnlyWhenAsked(t *testing.T) {
	svc := &stubService{}
	_, plain := do(t, svc, http.MethodGet, "/api/v1/stocks/aapl/candles?range=1m", nil)
	if strings.Contains(string(plain.Data), `"warmup"`) {
		t.Errorf("warm-up bars should be omitted by default: %s", plain.Data)
	}
	_, withWarmup := do(t, svc, http.MethodGet, "/api/v1/stocks/aapl/candles?range=1m&warmup=true", nil)
	if !strings.Contains(string(withWarmup.Data), `"warmup":[`) {
		t.Errorf("warmup=true should include warm-up bars: %s", withWarmup.Data)
	}
}
func (s *stubService) Levels(_ context.Context, sym market.Symbol, rng market.Range) (market.LevelsResult, error) {
	s.lastSymbol, s.lastRange = sym, rng
	return market.LevelsResult{Symbol: sym, Range: rng}, s.err
}
func (s *stubService) NextEarnings(_ context.Context, sym market.Symbol) (market.EarningsResult, error) {
	s.lastSymbol = sym
	return market.EarningsResult{Symbol: sym, Next: &market.EarningsEvent{Symbol: string(sym), Date: "2026-11-02", Hour: "amc"}}, s.err
}
func (s *stubService) Fundamentals(_ context.Context, sym market.Symbol) (market.FundamentalsResult, error) {
	s.lastSymbol = sym
	return market.FundamentalsResult{Fundamentals: market.Fundamentals{Symbol: string(sym), Industry: "Technology"}}, s.err
}
func (s *stubService) EarningsHistory(_ context.Context, sym market.Symbol) (market.EarningsHistoryResult, error) {
	s.lastSymbol = sym
	return market.EarningsHistoryResult{Symbol: sym, Quarters: []market.EarningsSurprise{{Period: "2026-06-30"}}}, s.err
}
func (s *stubService) Recommendations(_ context.Context, sym market.Symbol) (market.RecommendationsResult, error) {
	s.lastSymbol = sym
	return market.RecommendationsResult{Symbol: sym, Trends: []market.RecommendationTrend{{Period: "2026-10-01", Buy: 16}}}, s.err
}
func (s *stubService) MarketStatus(context.Context) (market.StatusResult, error) {
	return market.StatusResult{MarketStatus: market.MarketStatus{Exchange: "XNYS", IsOpen: true}}, s.err
}
func (s *stubService) Overview(context.Context) (market.Overview, error) {
	return market.Overview{}, s.err
}
func (s *stubService) Sectors(context.Context) (market.SectorsResult, error) {
	return market.SectorsResult{Sectors: []market.SectorPerformance{{Sector: "technology", Symbol: "XLK"}}}, s.err
}

type envelope struct {
	Data  json.RawMessage `json:"data"`
	Error *errorBody      `json:"error"`
}

func do(t *testing.T, svc MarketService, method, target string, header http.Header) (*httptest.ResponseRecorder, envelope) {
	t.Helper()
	h := NewRouter(Options{
		Service: svc, Logger: slog.New(slog.DiscardHandler), CORSOrigins: []string{"http://localhost:3000"},
		RequestTimeout: time.Second, Now: func() time.Time { return time.Unix(0, 0) },
	})
	req := httptest.NewRequestWithContext(context.Background(), method, target, nil)
	for k, v := range header {
		req.Header[k] = v
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var env envelope
	if rec.Body.Len() > 0 {
		if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
			t.Fatalf("response is not JSON: %s", rec.Body.String())
		}
	}
	return rec, env
}

func TestSuccessfulRequests(t *testing.T) {
	svc := &stubService{}
	cases := []struct {
		target     string
		wantInBody string
	}{
		{"/api/v1/health", `"status":"ok"`},
		{"/api/v1/market/status", `"isOpen":true`},
		{"/api/v1/market/overview", `"benchmarks"`},
		{"/api/v1/market/sectors", `"sector":"technology"`},
		{"/api/v1/stocks/search?q=apple", `"query":"apple"`},
		{"/api/v1/stocks/quotes?symbols=aapl,msft", `"quotes":[]`},
		{"/api/v1/stocks/aapl", `"symbol":"AAPL"`},
		{"/api/v1/stocks/aapl/quote", `"price":189.32`},
		{"/api/v1/stocks/aapl/candles?range=1y", `"range":"1y"`},
		{"/api/v1/stocks/aapl/levels", `"range":"3m"`},
		{"/api/v1/stocks/aapl/earnings", `"date":"2026-11-02"`},
		{"/api/v1/stocks/aapl/fundamentals", `"industry":"Technology"`},
		{"/api/v1/stocks/aapl/earnings/history", `"period":"2026-06-30"`},
		{"/api/v1/stocks/aapl/recommendations", `"buy":16`},
	}
	for _, tc := range cases {
		rec, env := do(t, svc, http.MethodGet, tc.target, nil)
		if rec.Code != http.StatusOK || env.Error != nil {
			t.Errorf("%s: status %d, body %s", tc.target, rec.Code, rec.Body)
			continue
		}
		if !strings.Contains(string(env.Data), tc.wantInBody) {
			t.Errorf("%s: data %s should contain %s", tc.target, env.Data, tc.wantInBody)
		}
		if rec.Header().Get("Cache-Control") != "no-store" || rec.Header().Get("X-Request-ID") == "" {
			t.Errorf("%s: missing no-store / request id headers", tc.target)
		}
	}
	if svc.lastSymbol != "AAPL" || len(svc.lastBatch) != 2 {
		t.Fatalf("handlers should pass normalized input: %+v", svc)
	}
}

func TestValidationErrors(t *testing.T) {
	for _, target := range []string{
		"/api/v1/stocks/search",
		"/api/v1/stocks/search?q=%3Cscript%3E",
		"/api/v1/stocks/quotes",
		"/api/v1/stocks/AAPL%3B/quote",
		"/api/v1/stocks/AAPL/candles?range=10y",
	} {
		rec, env := do(t, &stubService{}, http.MethodGet, target, nil)
		if rec.Code != http.StatusBadRequest || env.Error == nil || env.Error.Code != "invalid_request" {
			t.Errorf("%s: got %d %s", target, rec.Code, rec.Body)
			continue
		}
		if strings.HasPrefix(env.Error.Message, "invalid input") || env.Error.RequestID == "" {
			t.Errorf("%s: unexpected error body %+v", target, env.Error)
		}
	}
}

func TestServiceErrorMapping(t *testing.T) {
	cases := []struct {
		err    error
		status int
		code   string
	}{
		{market.ErrNotConfigured, http.StatusServiceUnavailable, "provider_not_configured"},
		{fmt.Errorf("%w: x", market.ErrNotFound), http.StatusNotFound, "not_found"},
		{fmt.Errorf("%w (twelvedata 429: secret detail)", market.ErrRateLimited), http.StatusTooManyRequests, "rate_limited"},
		{market.ErrUnauthorized, http.StatusBadGateway, "provider_auth_failed"},
		{market.ErrNotEntitled, http.StatusBadGateway, "provider_not_entitled"},
		{market.ErrUnavailable, http.StatusBadGateway, "provider_unavailable"},
		{context.DeadlineExceeded, http.StatusGatewayTimeout, "timeout"},
		{fmt.Errorf("unexpected"), http.StatusInternalServerError, "internal_error"},
	}
	for _, tc := range cases {
		rec, env := do(t, &stubService{err: tc.err}, http.MethodGet, "/api/v1/stocks/AAPL/quote", nil)
		if rec.Code != tc.status || env.Error == nil || env.Error.Code != tc.code {
			t.Errorf("%v: got %d %s", tc.err, rec.Code, rec.Body)
			continue
		}
		if strings.Contains(rec.Body.String(), "secret detail") || strings.Contains(rec.Body.String(), "twelvedata") {
			t.Errorf("provider details leaked: %s", rec.Body)
		}
	}
	rec, _ := do(t, &stubService{err: market.ErrRateLimited}, http.MethodGet, "/api/v1/stocks/AAPL/quote", nil)
	if rec.Header().Get("Retry-After") == "" {
		t.Error("rate-limited responses should set Retry-After")
	}
}

func TestPanicIsRecovered(t *testing.T) {
	rec, env := do(t, &stubService{panics: true}, http.MethodGet, "/api/v1/stocks/search?q=a", nil)
	if rec.Code != http.StatusInternalServerError || env.Error == nil || env.Error.Code != "internal_error" {
		t.Fatalf("got %d %s", rec.Code, rec.Body)
	}
}

func TestUnknownRouteAndMethod(t *testing.T) {
	rec, env := do(t, &stubService{}, http.MethodGet, "/api/v1/nope", nil)
	if rec.Code != http.StatusNotFound || env.Error == nil {
		t.Fatalf("got %d %s", rec.Code, rec.Body)
	}
	rec, env = do(t, &stubService{}, http.MethodPost, "/api/v1/health", nil)
	if rec.Code != http.StatusMethodNotAllowed || env.Error == nil {
		t.Fatalf("got %d %s", rec.Code, rec.Body)
	}
}

func TestCORS(t *testing.T) {
	rec, _ := do(t, &stubService{}, http.MethodGet, "/api/v1/health", http.Header{"Origin": {"http://localhost:3000"}})
	if rec.Header().Get("Access-Control-Allow-Origin") != "http://localhost:3000" {
		t.Fatalf("allowed origin not echoed: %v", rec.Header())
	}
	rec, _ = do(t, &stubService{}, http.MethodGet, "/api/v1/health", http.Header{"Origin": {"https://evil.example"}})
	if rec.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("unknown origin must not be allowed")
	}
	rec, _ = do(t, &stubService{}, http.MethodOptions, "/api/v1/health", http.Header{"Origin": {"http://localhost:3000"}})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("preflight status = %d", rec.Code)
	}
}

func TestRequestIDPropagation(t *testing.T) {
	rec, _ := do(t, &stubService{}, http.MethodGet, "/api/v1/health", http.Header{"X-Request-Id": {"abc-123"}})
	if rec.Header().Get("X-Request-ID") != "abc-123" {
		t.Fatalf("valid incoming id should be reused, got %q", rec.Header().Get("X-Request-ID"))
	}
	rec, _ = do(t, &stubService{}, http.MethodGet, "/api/v1/health", http.Header{"X-Request-Id": {"bad id\n"}})
	if got := rec.Header().Get("X-Request-ID"); got == "" || got == "bad id\n" {
		t.Fatalf("malformed id should be replaced, got %q", got)
	}
}
