package market

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/tonklasocute/mallowtick/services/api/internal/supportresistance"
)

// fakeProvider is a controllable Provider for service tests.
type fakeProvider struct {
	mu          sync.Mutex
	quotes      map[Symbol]Quote
	quoteErr    error
	candles     CandleSeries
	quoteCalls  atomic.Int32
	candleCalls atomic.Int32
	block       chan struct{} // when set, Quotes waits on it
}

func (f *fakeProvider) Name() string     { return "fake" }
func (f *fakeProvider) Configured() bool { return true }
func (f *fakeProvider) SearchSymbols(context.Context, string, int) ([]Instrument, error) {
	return []Instrument{{Symbol: "AAPL", Name: "Apple Inc"}}, nil
}
func (f *fakeProvider) Quotes(_ context.Context, symbols []Symbol) (map[Symbol]Quote, error) {
	f.quoteCalls.Add(1)
	if f.block != nil {
		<-f.block
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.quoteErr != nil {
		return nil, f.quoteErr
	}
	out := map[Symbol]Quote{}
	for _, s := range symbols {
		if q, ok := f.quotes[s]; ok {
			out[s] = q
		}
	}
	return out, nil
}
func (f *fakeProvider) Candles(context.Context, Symbol, Interval, int) (CandleSeries, error) {
	f.candleCalls.Add(1)
	return f.candles, nil
}
func (f *fakeProvider) MarketStatus(context.Context) (MarketStatus, error) {
	return MarketStatus{Exchange: "XNYS", IsOpen: true}, nil
}

func (f *fakeProvider) setErr(err error) {
	f.mu.Lock()
	f.quoteErr = err
	f.mu.Unlock()
}

type testClock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *testClock) now() time.Time { c.mu.Lock(); defer c.mu.Unlock(); return c.t }
func (c *testClock) advance(d time.Duration) {
	c.mu.Lock()
	c.t = c.t.Add(d)
	c.mu.Unlock()
}

func newTestService(p Provider, clk *testClock) *Service {
	return NewService(p, ServiceConfig{
		Latency:         LatencyDelayed,
		QuoteTTL:        time.Minute,
		QuoteTTLClosed:  15 * time.Minute,
		StaleRetention:  24 * time.Hour,
		ProviderTimeout: time.Second,
		OverviewSymbols: []Symbol{"SPY", "QQQ"},
		PopularSymbols:  []Symbol{"AAPL"},
		Levels:          supportresistance.DefaultConfig(),
		Now:             clk.now,
	})
}

func boolPtr(b bool) *bool { return &b }

func quote(sym Symbol, price float64, open bool) Quote {
	asOf := time.Date(2026, 10, 23, 19, 59, 0, 0, time.UTC)
	return Quote{Symbol: string(sym), Name: string(sym) + " Inc", Price: price, IsMarketOpen: boolPtr(open), AsOf: &asOf}
}

func TestQuoteIsCachedWithFreshness(t *testing.T) {
	clk := &testClock{t: time.Date(2026, 10, 23, 20, 0, 0, 0, time.UTC)}
	p := &fakeProvider{quotes: map[Symbol]Quote{"AAPL": quote("AAPL", 189.32, true)}}
	s := newTestService(p, clk)
	ctx := context.Background()

	q1, err := s.Quote(ctx, "AAPL")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Quote(ctx, "AAPL"); err != nil {
		t.Fatal(err)
	}
	if p.quoteCalls.Load() != 1 {
		t.Fatalf("provider calls = %d, want 1 (cached)", p.quoteCalls.Load())
	}
	f := q1.Freshness
	if f.Provider != "fake" || f.Latency != LatencyDelayed || f.Stale || !f.FetchedAt.Equal(clk.now()) || !f.AsOf.Equal(*q1.AsOf) {
		t.Fatalf("unexpected freshness %+v", f)
	}

	clk.advance(2 * time.Minute)
	if _, err := s.Quote(ctx, "AAPL"); err != nil {
		t.Fatal(err)
	}
	if p.quoteCalls.Load() != 2 {
		t.Fatalf("expired quote should be refetched; calls = %d", p.quoteCalls.Load())
	}
}

func TestClosedMarketQuoteUsesLongerTTL(t *testing.T) {
	clk := &testClock{t: time.Unix(0, 0)}
	p := &fakeProvider{quotes: map[Symbol]Quote{"AAPL": quote("AAPL", 1, false)}}
	s := newTestService(p, clk)
	_, _ = s.Quote(context.Background(), "AAPL")
	clk.advance(10 * time.Minute)
	_, _ = s.Quote(context.Background(), "AAPL")
	if p.quoteCalls.Load() != 1 {
		t.Fatalf("closed-market quote should stay cached for 15m; calls = %d", p.quoteCalls.Load())
	}
}

func TestStaleFallbackIsMarked(t *testing.T) {
	clk := &testClock{t: time.Unix(0, 0)}
	p := &fakeProvider{quotes: map[Symbol]Quote{"AAPL": quote("AAPL", 1, true)}}
	s := newTestService(p, clk)
	ctx := context.Background()
	if _, err := s.Quote(ctx, "AAPL"); err != nil {
		t.Fatal(err)
	}
	firstFetch := clk.now()

	clk.advance(5 * time.Minute)
	p.setErr(fmt.Errorf("%w: boom", ErrUnavailable))
	q, err := s.Quote(ctx, "AAPL")
	if err != nil {
		t.Fatalf("expected stale fallback, got %v", err)
	}
	if !q.Freshness.Stale || !q.Freshness.FetchedAt.Equal(firstFetch) {
		t.Fatalf("fallback must be marked stale with its original fetch time: %+v", q.Freshness)
	}
}

func TestNoFallbackWithoutCache(t *testing.T) {
	p := &fakeProvider{quoteErr: ErrRateLimited}
	s := newTestService(p, &testClock{t: time.Unix(0, 0)})
	if _, err := s.Quote(context.Background(), "AAPL"); !errors.Is(err, ErrRateLimited) {
		t.Fatalf("got %v, want ErrRateLimited", err)
	}
}

func TestUnknownSymbolIsNotFound(t *testing.T) {
	p := &fakeProvider{quotes: map[Symbol]Quote{}}
	s := newTestService(p, &testClock{t: time.Unix(0, 0)})
	if _, err := s.Quote(context.Background(), "ZZZZ"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("got %v, want ErrNotFound", err)
	}
}

func TestBatchReportsUnavailableSymbols(t *testing.T) {
	p := &fakeProvider{quotes: map[Symbol]Quote{"AAPL": quote("AAPL", 1, true), "MSFT": quote("MSFT", 2, true)}}
	s := newTestService(p, &testClock{t: time.Unix(0, 0)})
	b, err := s.Quotes(context.Background(), []Symbol{"MSFT", "ZZZZ", "AAPL"})
	if err != nil {
		t.Fatal(err)
	}
	if len(b.Quotes) != 2 || b.Quotes[0].Symbol != "MSFT" || b.Quotes[1].Symbol != "AAPL" {
		t.Fatalf("quotes should keep request order: %+v", b.Quotes)
	}
	if len(b.Unavailable) != 1 || b.Unavailable[0] != (UnavailableSymbol{Symbol: "ZZZZ", Reason: "not_found"}) {
		t.Fatalf("unavailable = %+v", b.Unavailable)
	}
}

func TestBatchFailsWhenProviderFailsForAll(t *testing.T) {
	p := &fakeProvider{quoteErr: ErrNotConfigured}
	s := newTestService(p, &testClock{t: time.Unix(0, 0)})
	if _, err := s.Quotes(context.Background(), []Symbol{"AAPL", "MSFT"}); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("got %v, want ErrNotConfigured", err)
	}
}

func TestConcurrentRequestsShareOneProviderCall(t *testing.T) {
	p := &fakeProvider{quotes: map[Symbol]Quote{"AAPL": quote("AAPL", 1, true)}, block: make(chan struct{})}
	s := newTestService(p, &testClock{t: time.Unix(0, 0)})

	var wg sync.WaitGroup
	errs := make(chan error, 10)
	for range 10 {
		wg.Go(func() {
			_, err := s.Quote(context.Background(), "AAPL")
			errs <- err
		})
	}
	// Let the goroutines join the in-flight call before releasing it.
	for p.quoteCalls.Load() == 0 {
		time.Sleep(time.Millisecond)
	}
	time.Sleep(20 * time.Millisecond)
	close(p.block)
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	if n := p.quoteCalls.Load(); n != 1 {
		t.Fatalf("provider calls = %d, want 1", n)
	}
}

func TestOverviewSplitsConfiguredLists(t *testing.T) {
	p := &fakeProvider{quotes: map[Symbol]Quote{"SPY": quote("SPY", 1, true), "AAPL": quote("AAPL", 2, true)}}
	s := newTestService(p, &testClock{t: time.Unix(0, 0)})
	ov, err := s.Overview(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(ov.Benchmarks) != 1 || ov.Benchmarks[0].Symbol != "SPY" || len(ov.Popular) != 1 || ov.Popular[0].Symbol != "AAPL" {
		t.Fatalf("unexpected overview %+v", ov)
	}
	if len(ov.Unavailable) != 1 || ov.Unavailable[0].Symbol != "QQQ" {
		t.Fatalf("QQQ should be reported unavailable: %+v", ov.Unavailable)
	}
	if p.quoteCalls.Load() != 1 {
		t.Fatalf("overview should use one batch request; calls = %d", p.quoteCalls.Load())
	}
}

func TestLevelsReuseCachedCandles(t *testing.T) {
	var candles []Candle
	start := time.Date(2026, 1, 5, 14, 30, 0, 0, time.UTC)
	for i, c := range []float64{100, 102, 104, 106, 108, 110, 108, 106, 104, 102, 100, 102, 104, 106, 108, 110, 108, 106, 104, 102, 100, 102, 105} {
		candles = append(candles, Candle{Time: start.Add(time.Duration(i) * 24 * time.Hour), Open: c, High: c + 0.5, Low: c - 0.5, Close: c})
	}
	p := &fakeProvider{candles: CandleSeries{Symbol: "AAPL", Interval: Interval1Day, ExchangeTimezone: "America/New_York", Candles: candles}}
	s := newTestService(p, &testClock{t: time.Unix(0, 0)})
	ctx := context.Background()

	if _, err := s.Candles(ctx, "AAPL", Range3M); err != nil {
		t.Fatal(err)
	}
	lv, err := s.Levels(ctx, "AAPL", Range3M)
	if err != nil {
		t.Fatal(err)
	}
	if p.candleCalls.Load() != 1 {
		t.Fatalf("levels should reuse cached candles; calls = %d", p.candleCalls.Load())
	}
	if lv.Status != supportresistance.StatusOK || len(lv.Levels) == 0 {
		t.Fatalf("expected levels, got %+v", lv.Result)
	}
	if lv.Method.Name == "" || lv.Disclaimer == "" || lv.Interval != Interval1Day {
		t.Fatalf("missing method metadata: %+v", lv)
	}
	if lv.Freshness.AsOf == nil || !lv.Freshness.AsOf.Equal(candles[len(candles)-1].Time) {
		t.Fatalf("freshness.asOf should be the last candle time: %+v", lv.Freshness)
	}
}

func TestErrorCode(t *testing.T) {
	cases := map[error]string{
		fmt.Errorf("x: %w", ErrInvalidInput):  "invalid_request",
		ErrNotConfigured:                      "provider_not_configured",
		fmt.Errorf("%w (td)", ErrRateLimited): "rate_limited",
		context.DeadlineExceeded:              "timeout",
		errors.New("other"):                   "internal_error",
	}
	for err, want := range cases {
		if got := ErrorCode(err); got != want {
			t.Errorf("ErrorCode(%v) = %q, want %q", err, got, want)
		}
	}
}
