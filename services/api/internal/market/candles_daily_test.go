package market

import (
	"context"
	"slices"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func newYork(t *testing.T) *time.Location {
	t.Helper()
	ny, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatal(err)
	}
	return ny
}

// nyDailyBars is n consecutive daily bars opening at midnight New York time,
// the last on lastDay, like Twelve Data's daily series.
func nyDailyBars(ny *time.Location, n int, lastDay time.Time) []Candle {
	y, m, d := lastDay.In(ny).Date()
	out := make([]Candle, n)
	for i := range n {
		c := float64(100 + i)
		out[i] = Candle{
			Time: time.Date(y, m, d-(n-1-i), 0, 0, 0, 0, ny),
			Open: c, High: c + 1, Low: c - 1, Close: c, Volume: int64p(int64(1000 + i)),
		}
	}
	return out
}

func nyDailySeries(bars []Candle) CandleSeries {
	return CandleSeries{Symbol: "AAPL", Interval: Interval1Day, ExchangeTimezone: "America/New_York", Candles: bars}
}

func sameBar(a, b Candle) bool {
	sameVolume := (a.Volume == nil) == (b.Volume == nil) && (a.Volume == nil || *a.Volume == *b.Volume)
	return a.Time.Equal(b.Time) && a.Open == b.Open && a.High == b.High && a.Low == b.Low && a.Close == b.Close && sameVolume
}

func TestDailyRangesShareOneSeries(t *testing.T) {
	ny := newYork(t)
	ctx := context.Background()
	full := dailySeries.Bars + WarmupBars
	cases := []struct {
		name       string
		history    int // bars the vendor has
		rng        Range
		wantWarmup int
	}{
		{"1M with full history", full, Range1M, WarmupBars},
		{"3M with full history", full, Range3M, WarmupBars},
		{"1Y with full history", full, Range1Y, WarmupBars},
		{"1M with short history", 70, Range1M, 48},
		{"3M with short history", 70, Range3M, 7},
		{"1Y with short history", 70, Range1Y, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			bars := nyDailyBars(ny, tc.history, time.Date(2026, 11, 6, 0, 0, 0, 0, ny))
			p := &fakeProvider{candles: nyDailySeries(bars)}
			s := newTestService(p, &testClock{t: time.Date(2026, 11, 6, 15, 0, 0, 0, ny)})

			// Every daily range is read, so each case also shows they share the series.
			for _, rng := range []Range{Range1M, Range3M, Range1Y} {
				if _, err := s.Candles(ctx, "AAPL", rng); err != nil {
					t.Fatal(err)
				}
			}
			res, err := s.Candles(ctx, "AAPL", tc.rng)
			if err != nil {
				t.Fatal(err)
			}
			if p.candleCalls.Load() != 1 {
				t.Fatalf("1M, 3M and 1Y should share one provider call; calls = %d", p.candleCalls.Load())
			}
			if got, want := int(p.candleBars.Load()), Range1Y.Spec().Bars+WarmupBars; got != want {
				t.Fatalf("provider asked for %d bars, want %d (longest daily range + warm-up)", got, want)
			}
			wantVisible := min(tc.rng.Spec().Bars, tc.history)
			if len(res.Candles) != wantVisible || len(res.Warmup) != tc.wantWarmup {
				t.Fatalf("got %d bars and %d warm-up bars, want %d and %d", len(res.Candles), len(res.Warmup), wantVisible, tc.wantWarmup)
			}
			split := tc.history - wantVisible
			if !sameBar(res.Candles[0], bars[split]) || !sameBar(res.Candles[wantVisible-1], bars[tc.history-1]) {
				t.Fatal("the range should show the most recent bars")
			}
			if tc.wantWarmup > 0 && (!sameBar(res.Warmup[0], bars[split-tc.wantWarmup]) || !sameBar(res.Warmup[tc.wantWarmup-1], bars[split-1])) {
				t.Fatal("the warm-up should be the bars right before the range")
			}
			if res.Range != tc.rng || res.Interval != Interval1Day {
				t.Fatalf("range %q interval %q", res.Range, res.Interval)
			}
			if f := res.Freshness; f.Provider != "fake" || f.Stale || !f.AsOf.Equal(bars[tc.history-1].Time) {
				t.Fatalf("freshness should describe the vendor's last bar: %+v", f)
			}
		})
	}
}

func TestIntradayAndWeeklyRangesKeepTheirOwnSeries(t *testing.T) {
	ny := newYork(t)
	p := &fakeProvider{candles: nyDailySeries(nyDailyBars(ny, 30, time.Date(2026, 11, 6, 0, 0, 0, 0, ny)))}
	s := newTestService(p, &testClock{t: time.Date(2026, 11, 6, 15, 0, 0, 0, ny)})
	ctx := context.Background()
	if _, err := s.Candles(ctx, "AAPL", Range1M); err != nil {
		t.Fatal(err)
	}
	for i, rng := range []Range{Range1D, Range1W, Range5Y} {
		if _, err := s.Candles(ctx, "AAPL", rng); err != nil {
			t.Fatal(err)
		}
		if got, want := int(p.candleBars.Load()), rng.Spec().Bars+WarmupBars; got != want {
			t.Fatalf("%s asked for %d bars, want %d", rng, got, want)
		}
		if got := int(p.candleCalls.Load()); got != i+2 {
			t.Fatalf("%s should fetch its own series; calls = %d", rng, got)
		}
	}
}

// heldCandles holds candle requests until released, so concurrent requests
// can be seen joining the one in flight.
type heldCandles struct {
	*fakeProvider
	started atomic.Int32
	release chan struct{}
}

func (h *heldCandles) Candles(ctx context.Context, sym Symbol, iv Interval, bars int) (CandleSeries, error) {
	h.started.Add(1)
	<-h.release
	return h.fakeProvider.Candles(ctx, sym, iv, bars)
}

func TestConcurrentDailyRangesShareOneProviderCall(t *testing.T) {
	ny := newYork(t)
	p := &heldCandles{
		fakeProvider: &fakeProvider{candles: nyDailySeries(nyDailyBars(ny, 300, time.Date(2026, 11, 6, 0, 0, 0, 0, ny)))},
		release:      make(chan struct{}),
	}
	s := newTestService(p, &testClock{t: time.Date(2026, 11, 6, 15, 0, 0, 0, ny)})

	var wg sync.WaitGroup
	errs := make(chan error, 6)
	for _, rng := range []Range{Range1M, Range1Y, Range3M, Range1M, Range1Y, Range3M} {
		wg.Go(func() {
			_, err := s.Candles(context.Background(), "AAPL", rng)
			errs <- err
		})
	}
	// Let the goroutines join the in-flight call before releasing it.
	for p.started.Load() == 0 {
		time.Sleep(time.Millisecond)
	}
	time.Sleep(20 * time.Millisecond)
	close(p.release)
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	if n := p.candleCalls.Load(); n != 1 {
		t.Fatalf("provider calls = %d, want 1", n)
	}
}

func TestDailySeriesTTL(t *testing.T) {
	cases := []struct {
		name   string
		status *MarketStatus // nil: no status cached
		age    time.Duration // the cached status's age when the series is fetched
		keep   time.Duration // how long the series is then kept
	}{
		{"open: until the close", &MarketStatus{Exchange: "XNYS", IsOpen: true, ClosesInSeconds: int64p(3 * 3600)}, 30 * time.Minute, 150 * time.Minute},
		{"closed: until the open", closedFor(10 * time.Hour), time.Hour, 9 * time.Hour},
		{"open without a countdown: an hour", &MarketStatus{Exchange: "XNYS", IsOpen: true}, 0, time.Hour},
		{"status unknown: an hour", nil, 0, time.Hour},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ny := newYork(t)
			clk := &testClock{t: time.Date(2026, 11, 6, 12, 0, 0, 0, ny)}
			p := &fakeProvider{status: tc.status, candles: nyDailySeries(nyDailyBars(ny, 30, clk.now()))}
			s := newTestService(p, clk)
			ctx := context.Background()
			if tc.status != nil {
				if _, err := s.MarketStatus(ctx); err != nil {
					t.Fatal(err)
				}
			}
			statusCalls := p.statusCalls.Load()
			clk.advance(tc.age)

			_, _ = s.Candles(ctx, "AAPL", Range1M)
			clk.advance(tc.keep - time.Second)
			_, _ = s.Candles(ctx, "AAPL", Range1Y)
			if p.candleCalls.Load() != 1 {
				t.Fatalf("the series should be kept for %s; calls = %d", tc.keep, p.candleCalls.Load())
			}
			clk.advance(2 * time.Second)
			_, _ = s.Candles(ctx, "AAPL", Range3M)
			if p.candleCalls.Load() != 2 {
				t.Fatalf("the series should be refetched after %s; calls = %d", tc.keep, p.candleCalls.Load())
			}
			if p.statusCalls.Load() != statusCalls {
				t.Fatal("candles must never fetch the market status")
			}
		})
	}
}

func TestDailyBarFromCachedQuote(t *testing.T) {
	ny := newYork(t)
	day := func(d, h, m int) time.Time { return time.Date(2026, 11, d, h, m, 0, 0, ny) }
	at := func(d, h, m int) *time.Time { t := day(d, h, m); return &t }
	// sessionQuote is a quote with the session's open, high and low, like both vendors'.
	sessionQuote := func(asOf *time.Time) *Quote {
		open, high, low := 188.0, 191.0, 187.5
		return &Quote{Price: 190.5, Open: &open, High: &high, Low: &low, AsOf: asOf}
	}
	withVolume := sessionQuote(at(6, 11, 4))
	withVolume.Volume = int64p(5_000_000)
	withoutOHL := sessionQuote(at(6, 11, 4))
	withoutOHL.Open, withoutOHL.High, withoutOHL.Low = nil, nil, nil

	const history = 30
	type change int
	const (
		untouched change = iota
		replaced
		appended
	)
	cases := []struct {
		name      string
		lastBar   time.Time // the vendor's last daily bar
		quote     *Quote    // nil: no quote cached
		quoteWait time.Duration
		want      change
	}{
		{name: "today's bar replaced, without the vendor's partial volume", lastBar: day(6, 0, 0), quote: sessionQuote(at(6, 11, 4)), want: replaced},
		{name: "today's bar replaced with the quote's volume", lastBar: day(6, 0, 0), quote: withVolume, want: replaced},
		{name: "new session appended", lastBar: day(5, 0, 0), quote: sessionQuote(at(6, 11, 4)), want: appended},
		{name: "quote from an earlier session", lastBar: day(6, 0, 0), quote: sessionQuote(at(5, 16, 0)), want: untouched},
		{name: "series fetched after the quote", lastBar: day(6, 0, 0), quote: sessionQuote(at(6, 10, 59)), want: untouched},
		{name: "stale quote", lastBar: day(6, 0, 0), quote: sessionQuote(at(6, 11, 4)), quoteWait: 2 * time.Minute, want: untouched},
		{name: "quote without open, high and low", lastBar: day(6, 0, 0), quote: withoutOHL, want: untouched},
		{name: "quote without a time", lastBar: day(6, 0, 0), quote: sessionQuote(nil), want: untouched},
		{name: "no quote", lastBar: day(6, 0, 0), want: untouched},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			bars := nyDailyBars(ny, history, tc.lastBar)
			vendor := slices.Clone(bars)
			p := &fakeProvider{candles: nyDailySeries(bars), quotes: map[Symbol]Quote{}}
			clk := &testClock{t: day(6, 11, 0)}
			s := newTestService(p, clk)
			ctx := context.Background()

			if _, err := s.Candles(ctx, "AAPL", Range1M); err != nil {
				t.Fatal(err)
			}
			seriesAt := clk.now()
			clk.advance(5 * time.Minute)
			if tc.quote != nil {
				q := *tc.quote
				q.Symbol, q.IsMarketOpen = "AAPL", boolPtr(true)
				p.quotes["AAPL"] = q
				if _, err := s.Quote(ctx, "AAPL"); err != nil {
					t.Fatal(err)
				}
			}
			quoteAt := clk.now()
			clk.advance(tc.quoteWait)

			res, err := s.Candles(ctx, "AAPL", Range1M)
			if err != nil {
				t.Fatal(err)
			}
			total := history
			if tc.want == appended {
				total++
			}
			if len(res.Candles) != Range1M.Spec().Bars || len(res.Warmup) != total-Range1M.Spec().Bars {
				t.Fatalf("got %d bars and %d warm-up bars from %d", len(res.Candles), len(res.Warmup), total)
			}
			got := res.Candles[len(res.Candles)-1]
			f := res.Freshness
			switch tc.want {
			case untouched:
				if !sameBar(got, vendor[history-1]) {
					t.Fatalf("the vendor's last bar should be shown as is, got %+v", got)
				}
				if !f.AsOf.Equal(vendor[history-1].Time) || !f.FetchedAt.Equal(seriesAt) {
					t.Fatalf("freshness should describe the vendor's series: %+v", f)
				}
			case replaced, appended:
				q := tc.quote
				want := Candle{Time: tc.lastBar, Open: *q.Open, High: *q.High, Low: *q.Low, Close: q.Price, Volume: q.Volume}
				if tc.want == appended {
					want.Time = day(6, 0, 0)
					if prev := res.Candles[len(res.Candles)-2]; !sameBar(prev, vendor[history-1]) {
						t.Fatalf("the vendor's last bar should stay before the new one, got %+v", prev)
					}
				}
				if !sameBar(got, want) {
					t.Fatalf("last bar = %+v (volume %v), want %+v (volume %v)", got, got.Volume, want, want.Volume)
				}
				if !f.AsOf.Equal(*q.AsOf) || !f.FetchedAt.Equal(quoteAt) || f.Provider != "fake" || f.Stale {
					t.Fatalf("freshness should be the quote's: %+v", f)
				}
			}

			cached, _ := s.candles.Get(dailyKey("AAPL"))
			if len(cached.Value.Candles) != history {
				t.Fatalf("the cached series must not grow: %d bars", len(cached.Value.Candles))
			}
			for i := range vendor {
				if !sameBar(cached.Value.Candles[i], vendor[i]) {
					t.Fatalf("the cached series must stay the vendor's data; bar %d = %+v", i, cached.Value.Candles[i])
				}
			}
		})
	}
}

func TestDailyBarFromQuoteNamesBothVendors(t *testing.T) {
	ny := newYork(t)
	asOf := time.Date(2026, 11, 6, 11, 4, 0, 0, ny)
	open, high, low := 188.0, 191.0, 187.5
	q := Quote{Symbol: "AAPL", Price: 190.5, Open: &open, High: &high, Low: &low, IsMarketOpen: boolPtr(true), AsOf: &asOf}
	cases := []struct {
		name               string
		quoteVendor, bars  string
		fetchQuote         bool
		wantProvider       string
		wantAsOfFromTheBar bool
	}{
		{"quote from another vendor", "finnhub", "twelvedata", true, "twelvedata+finnhub", false},
		{"no quote cached", "finnhub", "twelvedata", false, "twelvedata", true},
		{"quote from the bar vendor", "twelvedata", "twelvedata", true, "twelvedata", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			bars := nyDailyBars(ny, 30, asOf)
			clk := &testClock{t: time.Date(2026, 11, 6, 11, 0, 0, 0, ny)}
			s := newTestService(Composite{
				QuoteSource: namedFake{&fakeProvider{quotes: map[Symbol]Quote{"AAPL": q}}, tc.quoteVendor},
				BarSource:   namedFake{&fakeProvider{candles: nyDailySeries(bars)}, tc.bars},
			}, clk)
			ctx := context.Background()
			if _, err := s.Candles(ctx, "AAPL", Range3M); err != nil {
				t.Fatal(err)
			}
			clk.advance(5 * time.Minute)
			if tc.fetchQuote {
				if _, err := s.Quote(ctx, "AAPL"); err != nil {
					t.Fatal(err)
				}
			}
			c, err := s.Candles(ctx, "AAPL", Range3M)
			if err != nil {
				t.Fatal(err)
			}
			lv, err := s.Levels(ctx, "AAPL", Range3M)
			if err != nil {
				t.Fatal(err)
			}
			wantAsOf := asOf
			if tc.wantAsOfFromTheBar {
				wantAsOf = bars[len(bars)-1].Time
			}
			for what, f := range map[string]Freshness{"candles": c.Freshness, "levels": lv.Freshness} {
				if f.Provider != tc.wantProvider || !f.AsOf.Equal(wantAsOf) {
					t.Fatalf("%s freshness = %+v, want provider %q as of %v", what, f, tc.wantProvider, wantAsOf)
				}
			}
		})
	}
}

// failingCandles fails candle requests once fail is set.
type failingCandles struct {
	*fakeProvider
	fail atomic.Bool
}

func (f *failingCandles) Candles(ctx context.Context, sym Symbol, iv Interval, bars int) (CandleSeries, error) {
	if f.fail.Load() {
		f.candleCalls.Add(1)
		return CandleSeries{}, ErrUnavailable
	}
	return f.fakeProvider.Candles(ctx, sym, iv, bars)
}

func TestStaleDailySeriesStaysStaleWithTheQuoteBar(t *testing.T) {
	ny := newYork(t)
	asOf := time.Date(2026, 11, 6, 13, 0, 0, 0, ny)
	open, high, low := 188.0, 191.0, 187.5
	q := Quote{Symbol: "AAPL", Price: 190.5, Open: &open, High: &high, Low: &low, IsMarketOpen: boolPtr(true), AsOf: &asOf}
	p := &failingCandles{fakeProvider: &fakeProvider{
		candles: nyDailySeries(nyDailyBars(ny, 30, asOf)), quotes: map[Symbol]Quote{"AAPL": q},
	}}
	clk := &testClock{t: time.Date(2026, 11, 6, 11, 0, 0, 0, ny)}
	s := newTestService(p, clk)
	ctx := context.Background()
	if _, err := s.Candles(ctx, "AAPL", Range1M); err != nil {
		t.Fatal(err)
	}

	clk.advance(2*time.Hour + time.Minute) // past the series' hour without a cached status
	p.fail.Store(true)
	if _, err := s.Quote(ctx, "AAPL"); err != nil {
		t.Fatal(err)
	}
	res, err := s.Candles(ctx, "AAPL", Range1M)
	if err != nil {
		t.Fatalf("expected the stale series, got %v", err)
	}
	if p.candleCalls.Load() != 2 {
		t.Fatalf("the expired series should have been refetched; calls = %d", p.candleCalls.Load())
	}
	if last := res.Candles[len(res.Candles)-1]; last.Close != q.Price {
		t.Fatalf("the quote should still update the session's bar, got close %v", last.Close)
	}
	if f := res.Freshness; !f.Stale || !f.AsOf.Equal(asOf) {
		t.Fatalf("a bar from the quote on a stale series is still stale: %+v", f)
	}
}

func TestSessionVolumeReadsTheDailySeriesFetchedAfterTheClose(t *testing.T) {
	ny := newYork(t)
	session := time.Date(2026, 10, 26, 0, 0, 0, 0, ny)
	// Finnhub-like quotes: the session's open, high and low, but no volume.
	sessionQuote := func(asOf time.Time, open bool) Quote {
		o, h, l := 188.0, 191.0, 187.5
		return Quote{Symbol: "AAPL", Price: 190.5, Open: &o, High: &h, Low: &l, IsMarketOpen: boolPtr(open), AsOf: &asOf}
	}
	during := nyDailyBars(ny, 30, session)
	during[29].Volume = int64p(10_000_000) // partial while the session runs
	final := nyDailyBars(ny, 30, session)
	final[29].Volume = int64p(39_500_000)

	clk := &testClock{t: time.Date(2026, 10, 26, 15, 0, 0, 0, ny)}
	p := &fakeProvider{
		quotes:  map[Symbol]Quote{"AAPL": sessionQuote(clk.now(), true)},
		candles: nyDailySeries(during),
		status:  &MarketStatus{Exchange: "XNYS", IsOpen: true, ClosesInSeconds: int64p(3600)},
	}
	s := newTestService(p, clk)
	ctx := context.Background()
	_, _ = s.MarketStatus(ctx)
	_, _ = s.Candles(ctx, "AAPL", Range1M)
	if got, _ := s.Quote(ctx, "AAPL"); got.Volume != nil {
		t.Fatalf("no volume while the session is running, got %d", *got.Volume)
	}

	clk.advance(time.Hour + time.Minute)
	p.status, p.candles = closedFor(17*time.Hour+29*time.Minute), nyDailySeries(final)
	p.quotes["AAPL"] = sessionQuote(time.Date(2026, 10, 26, 16, 0, 0, 0, ny), false) // the session's last trade
	_, _ = s.MarketStatus(ctx)
	if got, _ := s.Quote(ctx, "AAPL"); got.Volume != nil {
		t.Fatalf("the series fetched during the session expired at the close; got volume %d", *got.Volume)
	}

	res, _ := s.Candles(ctx, "AAPL", Range1Y)
	if p.candleCalls.Load() != 2 {
		t.Fatalf("the first chart request after the close should refetch; calls = %d", p.candleCalls.Load())
	}
	if got, _ := s.Quote(ctx, "AAPL"); got.Volume == nil || *got.Volume != 39_500_000 {
		t.Fatalf("volume should be the session's final daily bar, got %v", got.Volume)
	}
	if last := res.Candles[len(res.Candles)-1]; last.Volume == nil || *last.Volume != 39_500_000 {
		t.Fatalf("the chart should keep the final bar's volume, got %v", last.Volume)
	}
}
