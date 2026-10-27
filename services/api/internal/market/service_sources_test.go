package market

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"
)

// namedFake is a fakeProvider reporting a different vendor name.
type namedFake struct {
	*fakeProvider
	name string
}

func (n namedFake) Name() string { return n.name }

// earningsFake is a quote vendor that also publishes an earnings calendar.
type earningsFake struct {
	namedFake
	calls atomic.Int32
	next  *EarningsEvent
}

func (e *earningsFake) NextEarnings(context.Context, Symbol, time.Time) (*EarningsEvent, error) {
	e.calls.Add(1)
	return e.next, nil
}

func (e *earningsFake) EarningsHistory(context.Context, Symbol) ([]EarningsSurprise, error) {
	e.calls.Add(1)
	return nil, nil // e.g. an ETF: no reported quarters
}

// fundamentalsFake is a quote vendor that, like Finnhub, publishes an earnings
// calendar and company fundamentals.
type fundamentalsFake struct {
	*earningsFake
	calls atomic.Int32
}

func (f *fundamentalsFake) Fundamentals(_ context.Context, sym Symbol) (Fundamentals, error) {
	f.calls.Add(1)
	return Fundamentals{Symbol: string(sym), Industry: "Technology"}, nil
}

func (f *fundamentalsFake) Recommendations(context.Context, Symbol) ([]RecommendationTrend, error) {
	f.calls.Add(1)
	return []RecommendationTrend{{Period: "2026-10-01", StrongBuy: 7, Buy: 16, Hold: 5}}, nil
}

func int64p(n int64) *int64 { return &n }

func TestCompositeNamesTheVendorBehindEachKind(t *testing.T) {
	clk := &testClock{t: time.Unix(0, 0)}
	quotes := &fundamentalsFake{earningsFake: &earningsFake{
		namedFake: namedFake{&fakeProvider{quotes: map[Symbol]Quote{"AAPL": quote("AAPL", 1, true)}}, "finnhub"},
	}}
	bars := namedFake{&fakeProvider{candles: CandleSeries{Symbol: "AAPL"}}, "twelvedata"}
	s := newTestService(Composite{QuoteSource: quotes, BarSource: bars}, clk)
	ctx := context.Background()

	q, err := s.Quote(ctx, "AAPL")
	if err != nil || q.Freshness.Provider != "finnhub" {
		t.Fatalf("quote freshness should name the quote vendor: %+v %v", q.Freshness, err)
	}
	c, err := s.Candles(ctx, "AAPL", Range1M)
	if err != nil || c.Freshness.Provider != "twelvedata" {
		t.Fatalf("candle freshness should name the candle vendor: %+v %v", c.Freshness, err)
	}
	if bars.candleCalls.Load() != 1 || quotes.candleCalls.Load() != 0 {
		t.Fatal("candles must come from the bar vendor only")
	}

	info := s.ProviderInfo()
	if info.Name != "finnhub+twelvedata" || info.Sources[KindQuotes].Name != "finnhub" ||
		info.Sources[KindCandles].Name != "twelvedata" || info.Sources[KindStatus].Name != "twelvedata" ||
		info.Sources[KindEarnings].Name != "finnhub" || info.Sources[KindFundamentals].Name != "finnhub" {
		t.Fatalf("unexpected provider info: %+v", info)
	}
}

func TestSingleVendorHasNoEarningsSource(t *testing.T) {
	s := newTestService(&fakeProvider{}, &testClock{t: time.Unix(0, 0)})
	if _, ok := s.ProviderInfo().Sources[KindEarnings]; ok {
		t.Fatal("a vendor without an earnings calendar should not be listed for earnings")
	}
	if _, err := s.NextEarnings(context.Background(), "AAPL"); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("got %v, want ErrNotConfigured", err)
	}
	if _, ok := s.ProviderInfo().Sources[KindFundamentals]; ok {
		t.Fatal("a vendor without fundamentals should not be listed for them")
	}
	if _, err := s.Fundamentals(context.Background(), "AAPL"); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("got %v, want ErrNotConfigured", err)
	}
}

func TestFundamentalsAreCached(t *testing.T) {
	clk := &testClock{t: time.Unix(0, 0)}
	quotes := &fundamentalsFake{earningsFake: &earningsFake{namedFake: namedFake{&fakeProvider{}, "finnhub"}}}
	s := newTestService(Composite{QuoteSource: quotes, BarSource: &fakeProvider{}}, clk)
	for range 2 {
		r, err := s.Fundamentals(context.Background(), "AAPL")
		if err != nil || r.Industry != "Technology" || r.Freshness.Provider != "finnhub" {
			t.Fatalf("unexpected result %+v %v", r, err)
		}
	}
	if quotes.calls.Load() != 1 {
		t.Fatalf("fundamentals should be cached; calls = %d", quotes.calls.Load())
	}
	clk.advance(fundamentalsTTL + time.Second)
	if _, err := s.Fundamentals(context.Background(), "AAPL"); err != nil || quotes.calls.Load() != 2 {
		t.Fatalf("expired fundamentals should be refetched; calls = %d, err = %v", quotes.calls.Load(), err)
	}
}

func TestNextEarningsIsCached(t *testing.T) {
	clk := &testClock{t: time.Unix(0, 0)}
	quotes := &earningsFake{namedFake: namedFake{&fakeProvider{}, "finnhub"}, next: &EarningsEvent{Symbol: "AAPL", Date: "2026-11-02", Hour: "amc"}}
	s := newTestService(Composite{QuoteSource: quotes, BarSource: &fakeProvider{}}, clk)
	for range 2 {
		r, err := s.NextEarnings(context.Background(), "AAPL")
		if err != nil || r.Next == nil || r.Next.Date != "2026-11-02" || r.Freshness.Provider != "finnhub" {
			t.Fatalf("unexpected result %+v %v", r, err)
		}
	}
	if quotes.calls.Load() != 1 {
		t.Fatalf("earnings should be cached; calls = %d", quotes.calls.Load())
	}
}

func TestQuoteWithoutMarketStateUsesCachedStatus(t *testing.T) {
	clk := &testClock{t: time.Unix(0, 0)}
	q := quote("AAPL", 1, true)
	q.IsMarketOpen = nil // e.g. Finnhub quotes
	p := &fakeProvider{quotes: map[Symbol]Quote{"AAPL": q}, status: closedFor(10 * time.Hour)}
	s := newTestService(p, clk)
	ctx := context.Background()

	if _, err := s.MarketStatus(ctx); err != nil {
		t.Fatal(err)
	}
	got, err := s.Quote(ctx, "AAPL")
	if err != nil || got.IsMarketOpen == nil || *got.IsMarketOpen {
		t.Fatalf("market state should come from the cached closed status: %+v %v", got.IsMarketOpen, err)
	}
	clk.advance(9 * time.Hour)
	_, _ = s.Quote(ctx, "AAPL")
	if p.quoteCalls.Load() != 1 {
		t.Fatalf("a closed-market quote should be kept until the open; calls = %d", p.quoteCalls.Load())
	}
}

func TestQuoteVolumeComesFromTheFinalDailyBar(t *testing.T) {
	ny, _ := time.LoadLocation("America/New_York")
	asOf := time.Date(2026, 10, 26, 16, 0, 0, 0, ny) // the session's last trade
	q := quote("AAPL", 1, false)
	q.AsOf, q.Volume = &asOf, nil
	daily := CandleSeries{Symbol: "AAPL", Interval: Interval1Day, ExchangeTimezone: "America/New_York", Candles: []Candle{
		{Time: time.Date(2026, 10, 23, 0, 0, 0, 0, ny), Volume: int64p(41_000_000)},
		{Time: time.Date(2026, 10, 26, 0, 0, 0, 0, ny), Volume: int64p(39_500_000)},
	}}
	ctx := context.Background()
	clk := &testClock{t: time.Date(2026, 10, 26, 17, 0, 0, 0, ny)}

	// Market still open (per the cached status): the day's bar is not final.
	open := newTestService(&fakeProvider{quotes: map[Symbol]Quote{"AAPL": q}, candles: daily}, clk)
	_, _ = open.MarketStatus(ctx)
	_, _ = open.Candles(ctx, "AAPL", Range1M)
	if got, _ := open.Quote(ctx, "AAPL"); got.Volume != nil {
		t.Fatalf("no volume while the session is running, got %d", *got.Volume)
	}

	closed := newTestService(&fakeProvider{quotes: map[Symbol]Quote{"AAPL": q}, candles: daily, status: closedFor(16 * time.Hour)}, clk)
	_, _ = closed.MarketStatus(ctx)
	if got, _ := closed.Quote(ctx, "AAPL"); got.Volume != nil {
		t.Fatalf("without cached daily bars the volume stays unknown, got %d", *got.Volume)
	}
	_, _ = closed.Candles(ctx, "AAPL", Range1M)
	if got, _ := closed.Quote(ctx, "AAPL"); got.Volume == nil || *got.Volume != 39_500_000 {
		t.Fatalf("volume should be the session's final daily bar, got %v", got.Volume)
	}
}

// rangeFake is a quote vendor that looks up 52-week ranges separately.
type rangeFake struct {
	*fakeProvider
	calls atomic.Int32
}

func (r *rangeFake) FiftyTwoWeek(context.Context, Symbol) (*Range52, error) {
	r.calls.Add(1)
	return &Range52{Low: 243.42, High: 351.73}, nil
}

func TestSingleQuoteAddsTheRangeEvenWhenCachedFromABatch(t *testing.T) {
	q := quote("AAPL", 1, true)
	p := &rangeFake{fakeProvider: &fakeProvider{quotes: map[Symbol]Quote{"AAPL": q, "MSFT": quote("MSFT", 2, true)}}}
	s := newTestService(p, &testClock{t: time.Unix(0, 0)})
	ctx := context.Background()

	b, _ := s.Quotes(ctx, []Symbol{"AAPL", "MSFT"})
	if b.Quotes[0].FiftyTwoWeek != nil || p.calls.Load() != 0 {
		t.Fatal("batch quotes should not look up ranges")
	}
	got, err := s.Quote(ctx, "AAPL")
	if err != nil || got.FiftyTwoWeek == nil || got.FiftyTwoWeek.High != 351.73 {
		t.Fatalf("single quote should carry the range: %+v %v", got.FiftyTwoWeek, err)
	}
}

func TestEarningsHistoryAndRecommendationsAreCached(t *testing.T) {
	clk := &testClock{t: time.Unix(0, 0)}
	quotes := &fundamentalsFake{earningsFake: &earningsFake{namedFake: namedFake{&fakeProvider{}, "finnhub"}}}
	s := newTestService(Composite{QuoteSource: quotes, BarSource: &fakeProvider{}}, clk)
	ctx := context.Background()
	for range 2 {
		h, err := s.EarningsHistory(ctx, "SPY")
		if err != nil || h.Quarters == nil || len(h.Quarters) != 0 || h.Freshness.Provider != "finnhub" {
			t.Fatalf("no quarters should be an empty list, not null: %+v %v", h, err)
		}
		r, err := s.Recommendations(ctx, "RKLB")
		if err != nil || len(r.Trends) != 1 || r.Trends[0].Buy != 16 {
			t.Fatalf("unexpected recommendations %+v %v", r, err)
		}
	}
	if quotes.earningsFake.calls.Load() != 1 || quotes.calls.Load() != 1 {
		t.Fatalf("both should be cached; calls = %d, %d", quotes.earningsFake.calls.Load(), quotes.calls.Load())
	}
}
