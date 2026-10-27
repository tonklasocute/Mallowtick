package market

import (
	"context"
	"errors"
	"slices"
	"sync/atomic"
	"testing"
	"time"

	"github.com/tonklasocute/mallowtick/services/api/internal/cache"
)

// sectorsFake is a quote vendor that reports performance on its own. Symbols
// without returns fail with err.
type sectorsFake struct {
	namedFake
	dayCalls, returnCalls atomic.Int32
	returns               map[Symbol]PriceReturns
	err                   error
}

func (f *sectorsFake) DayChanges(_ context.Context, symbols []Symbol) (map[Symbol]Quote, error) {
	f.dayCalls.Add(1)
	out := map[Symbol]Quote{}
	for _, sym := range symbols {
		if q, ok := f.quotes[sym]; ok {
			q.Name = "" // no profile lookup
			out[sym] = q
		}
	}
	return out, nil
}

func (f *sectorsFake) PriceReturns(_ context.Context, sym Symbol) (PriceReturns, error) {
	f.returnCalls.Add(1)
	r, ok := f.returns[sym]
	if !ok {
		return PriceReturns{}, f.err
	}
	return r, nil
}

func f64(v float64) *float64 { return &v }

func newSectorsFake(quotes map[Symbol]Quote, returns map[Symbol]PriceReturns, err error) *sectorsFake {
	return &sectorsFake{namedFake: namedFake{&fakeProvider{quotes: quotes}, "finnhub"}, returns: returns, err: err}
}

func TestSectorsCombineQuotesAndReturns(t *testing.T) {
	clk := &testClock{t: time.Date(2026, 10, 27, 14, 0, 0, 0, time.UTC)}
	spy, xlk, xlf := quote("SPY", 765.37, true), quote("XLK", 150, true), quote("XLF", 50, true)
	spy.ChangePercent, xlk.ChangePercent, xlf.ChangePercent = f64(0.71), f64(-0.4), f64(0.2)
	vendor := newSectorsFake(
		map[Symbol]Quote{"SPY": spy, "XLK": xlk, "XLF": xlf},
		map[Symbol]PriceReturns{
			"SPY": {Week: f64(-0.85), Quarter: f64(2.85), YTD: f64(11.45), Year: f64(13.13)},
			"XLE": {Week: f64(2.26), YTD: f64(55.07)},
			"XLK": {Week: f64(-1.47)},
		},
		ErrRateLimited,
	)
	s := newTestService(Composite{QuoteSource: vendor, BarSource: &fakeProvider{}}, clk)

	r, err := s.Sectors(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	b := r.Benchmark
	if b == nil || b.Symbol != "SPY" || b.Sector != "" || *b.Returns.Day != 0.71 || *b.Returns.Week != -0.85 ||
		*b.Returns.Quarter != 2.85 || *b.Returns.YTD != 11.45 || *b.Returns.Year != 13.13 {
		t.Fatalf("unexpected benchmark: %+v", b)
	}
	// XLE has returns but no quote (unknown to the quote vendor), XLK both, XLF a quote
	// whose returns hit the rate limit; the rest neither.
	if len(r.Sectors) != 3 || r.Sectors[0].Sector != "energy" || r.Sectors[0].Returns.Day != nil ||
		*r.Sectors[0].Returns.YTD != 55.07 || r.Sectors[1].Sector != "financials" ||
		*r.Sectors[1].Returns.Day != 0.2 || r.Sectors[1].Returns.Week != nil || r.Sectors[2].Sector != "technology" ||
		*r.Sectors[2].Returns.Day != -0.4 || *r.Sectors[2].Returns.Week != -1.47 || r.Sectors[2].Returns.Year != nil {
		t.Fatalf("unexpected sectors: %+v", r.Sectors)
	}
	// Missing symbols and XLF's missing half are listed so clients ask again; XLE's
	// not-found quote is not.
	var missing []Symbol
	for _, u := range r.Unavailable {
		if u.Reason != "rate_limited" {
			t.Fatalf("unexpected reason: %+v", u)
		}
		missing = append(missing, u.Symbol)
	}
	if want := []Symbol{"XLB", "XLI", "XLY", "XLP", "XLV", "XLF", "XLC", "XLU", "XLRE"}; !slices.Equal(missing, want) {
		t.Fatalf("unavailable = %v, want %v", missing, want)
	}
	if r.Freshness.Provider != "finnhub" || r.Freshness.AsOf == nil || !r.Freshness.AsOf.Equal(*spy.AsOf) {
		t.Fatalf("freshness should name the vendor and the quotes' time: %+v", r.Freshness)
	}
	if vendor.quoteCalls.Load() != 0 {
		t.Fatal("sectors should use name-free quotes, not Quotes")
	}

	// A second call is served from the caches; only the symbols that failed are retried.
	returnCalls, dayCalls := vendor.returnCalls.Load(), vendor.dayCalls.Load()
	if _, err := s.Sectors(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := vendor.returnCalls.Load() - returnCalls; got != int32(len(Sectors)-2) { // the 8 missing and XLF
		t.Fatalf("only the failed symbols should be refetched; returns calls = %d", got)
	}
	if vendor.dayCalls.Load() != dayCalls+1 {
		t.Fatalf("cached quotes should not be refetched; day-change calls %d -> %d", dayCalls, vendor.dayCalls.Load())
	}

	// The name-free quotes stay out of the main quote cache, so other screens get names.
	if q, err := s.Quote(context.Background(), "XLK"); err != nil || q.Name != "XLK Inc" || vendor.quoteCalls.Load() != 1 {
		t.Fatalf("a quote after the sectors should be a full one: %+v %v", q, err)
	}
}

func TestSectorsReuseTheOverviewsQuote(t *testing.T) {
	vendor := newSectorsFake(map[Symbol]Quote{"SPY": quote("SPY", 765.37, true)},
		map[Symbol]PriceReturns{"SPY": {}}, ErrNotFound)
	s := newTestService(Composite{QuoteSource: vendor, BarSource: &fakeProvider{}}, &testClock{t: time.Unix(0, 0)})
	if _, err := s.Overview(context.Background()); err != nil {
		t.Fatal(err)
	}
	r, err := s.Sectors(context.Background())
	if err != nil || r.Benchmark == nil || r.Benchmark.Symbol != "SPY" {
		t.Fatalf("unexpected result: %+v %v", r, err)
	}
	if _, state := s.dayChanges.Get("SPY"); state != cache.Miss || vendor.dayCalls.Load() != 1 {
		t.Fatalf("SPY should come from the overview's quote; day-change calls = %d", vendor.dayCalls.Load())
	}
}

func TestSectorsFailWhenNothingResolves(t *testing.T) {
	vendor := newSectorsFake(nil, nil, ErrUnavailable)
	s := newTestService(Composite{QuoteSource: vendor, BarSource: &fakeProvider{}}, &testClock{t: time.Unix(0, 0)})
	if _, err := s.Sectors(context.Background()); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("got %v, want ErrUnavailable", err)
	}
}

func TestSectorsNeedAPerformanceVendor(t *testing.T) {
	p := &fakeProvider{}
	s := newTestService(p, &testClock{t: time.Unix(0, 0)})
	if _, err := s.Sectors(context.Background()); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("got %v, want ErrNotConfigured", err)
	}
	if p.quoteCalls.Load() != 0 {
		t.Fatal("sectors must not spend quote credits on a vendor without performance data")
	}
}
