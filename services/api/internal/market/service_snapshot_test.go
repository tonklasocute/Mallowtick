package market

import (
	"bytes"
	"context"
	"strings"
	"testing"
	"time"

	"github.com/tonklasocute/mallowtick/services/api/internal/cache"
)

func snapshotSeries() CandleSeries {
	start := time.Date(2026, 10, 1, 4, 0, 0, 0, time.UTC)
	var candles []Candle
	for i := range 5 {
		candles = append(candles, Candle{
			Time: start.AddDate(0, 0, i), Open: 10, High: 11, Low: 9, Close: 10.5 + float64(i), Volume: int64Ptr(1000),
		})
	}
	return CandleSeries{Symbol: "AAPL", Interval: Interval1Day, ExchangeTimezone: "America/New_York", Candles: candles}
}

// twelveDataAndFinnhub is a composite whose bar vendor also has exchange rates.
func twelveDataAndFinnhub() (Composite, *fxFake) {
	bars := &fxFake{namedFake: namedFake{&fakeProvider{candles: snapshotSeries()}, "twelvedata"}}
	quotes := namedFake{&fakeProvider{quotes: map[Symbol]Quote{"AAPL": quote("AAPL", 1, true)}}, "finnhub"}
	return Composite{QuoteSource: quotes, BarSource: bars}, bars
}

// restart saves s's caches and loads them into a new service for p on the
// same clock, as the API does across a restart.
func restart(t *testing.T, s *Service, p Provider, clk *testClock) *Service {
	t.Helper()
	var buf bytes.Buffer
	if err := s.SaveCache(&buf); err != nil {
		t.Fatal(err)
	}
	next := newTestService(p, clk)
	if err := next.LoadCache(&buf); err != nil {
		t.Fatal(err)
	}
	return next
}

// sameStates checks that every entry of want is in got with the same state
// and fetch time, and counts the states it saw.
func sameStates[V any](t *testing.T, name string, want, got *cache.TTL[V], seen map[cache.State]int) {
	t.Helper()
	items := want.Snapshot()
	if len(items) == 0 {
		t.Fatalf("%s: nothing cached before the restart", name)
	}
	for _, it := range items {
		we, ws := want.Get(it.Key)
		ge, gs := got.Get(it.Key)
		if gs != ws || !ge.StoredAt.Equal(we.StoredAt) {
			t.Errorf("%s %q: restored state %v stored at %v, want %v stored at %v", name, it.Key, gs, ge.StoredAt, ws, we.StoredAt)
		}
		seen[ws]++
	}
}

func TestCacheSnapshotKeepsFreshAndStaleState(t *testing.T) {
	clk := &testClock{t: time.Date(2026, 10, 23, 15, 0, 0, 0, time.UTC)}
	p, _ := twelveDataAndFinnhub()
	s := newTestService(p, clk)
	ctx := context.Background()
	for _, rng := range []Range{Range1D, Range5Y} {
		if _, err := s.Candles(ctx, "AAPL", rng); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.MarketStatus(ctx); err != nil { // open without a countdown: 5 min
		t.Fatal(err)
	}
	if _, err := s.ExchangeRate(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Quote(ctx, "AAPL"); err != nil {
		t.Fatal(err)
	}
	clk.advance(10 * time.Minute) // past 1D's and the status's TTL, inside 5Y's and the rate's

	p2, bars := twelveDataAndFinnhub()
	restored := restart(t, s, p2, clk)
	seen := map[cache.State]int{}
	sameStates(t, "candles", s.candles, restored.candles, seen)
	sameStates(t, "status", s.status, restored.status, seen)
	sameStates(t, "fx", s.fx, restored.fx, seen)
	if seen[cache.Fresh] == 0 || seen[cache.Stale] == 0 {
		t.Fatalf("the test should cover fresh and stale entries, saw %v", seen)
	}
	if _, st := restored.quotes.Get("AAPL"); st != cache.Miss {
		t.Fatalf("quotes come from Finnhub and are not saved, got %v", st)
	}

	// Fresh entries are served as they are, stale ones refetched.
	if _, err := restored.Candles(ctx, "AAPL", Range5Y); err != nil || bars.candleCalls.Load() != 0 {
		t.Fatalf("fresh 5Y candles should not be refetched; calls = %d, err = %v", bars.candleCalls.Load(), err)
	}
	if _, err := restored.Candles(ctx, "AAPL", Range1D); err != nil || bars.candleCalls.Load() != 1 {
		t.Fatalf("stale 1D candles should be refetched; calls = %d, err = %v", bars.candleCalls.Load(), err)
	}
	// A restored entry expires when the original would have.
	clk.advance(Range5Y.Spec().CacheTTL - 10*time.Minute - time.Second)
	if _, err := restored.Candles(ctx, "AAPL", Range5Y); err != nil || bars.candleCalls.Load() != 1 {
		t.Fatalf("5Y candles should stay fresh until their original expiry; calls = %d, err = %v", bars.candleCalls.Load(), err)
	}
	clk.advance(2 * time.Second)
	if _, err := restored.Candles(ctx, "AAPL", Range5Y); err != nil || bars.candleCalls.Load() != 2 {
		t.Fatalf("5Y candles should expire at their original time; calls = %d, err = %v", bars.candleCalls.Load(), err)
	}
}

func TestRestoredFreshCandlesSkipTheProvider(t *testing.T) {
	clk := &testClock{t: time.Date(2026, 10, 23, 15, 0, 0, 0, time.UTC)}
	s := newTestService(&fakeProvider{candles: snapshotSeries()}, clk)
	want, err := s.Candles(context.Background(), "AAPL", Range1M)
	if err != nil {
		t.Fatal(err)
	}
	clk.advance(10 * time.Minute)

	after := &fakeProvider{}
	got, err := restart(t, s, after, clk).Candles(context.Background(), "AAPL", Range1M)
	if err != nil {
		t.Fatal(err)
	}
	if n := after.candleCalls.Load(); n != 0 {
		t.Fatalf("a restored fresh series should not be refetched; calls = %d", n)
	}
	if len(got.Candles) != len(want.Candles) {
		t.Fatalf("got %d candles, want %d", len(got.Candles), len(want.Candles))
	}
	for i, c := range got.Candles {
		w := want.Candles[i]
		if !c.Time.Equal(w.Time) || c.Open != w.Open || c.High != w.High || c.Low != w.Low || c.Close != w.Close || *c.Volume != *w.Volume {
			t.Fatalf("candle %d: got %+v, want %+v", i, c, w)
		}
	}
	if got.Freshness.Stale || !got.Freshness.FetchedAt.Equal(want.Freshness.FetchedAt) {
		t.Fatalf("freshness should keep the original fetch time: %+v", got.Freshness)
	}
}

func TestRestoredStatusSkipsTheWarmUpCredit(t *testing.T) {
	clk := &testClock{t: time.Date(2026, 10, 24, 1, 0, 0, 0, time.UTC)}
	s := newTestService(&fakeProvider{status: closedFor(10 * time.Hour)}, clk)
	if _, err := s.MarketStatus(context.Background()); err != nil {
		t.Fatal(err)
	}
	clk.advance(time.Hour)

	after := &fakeProvider{}
	st, err := restart(t, s, after, clk).MarketStatus(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if n := after.statusCalls.Load(); n != 0 {
		t.Fatalf("a restored fresh status should not be refetched; calls = %d", n)
	}
	if st.OpensInSeconds == nil || *st.OpensInSeconds != int64(9*time.Hour/time.Second) {
		t.Fatalf("the countdown should count from the original fetch, got %v", st.OpensInSeconds)
	}
}

func TestLoadCacheRejectsOtherVersionsAndBadFiles(t *testing.T) {
	for name, file := range map[string]string{
		"version":   `{"version":99,"candles":[{"key":"candles:AAPL:1m","value":{},"storedAt":"2026-10-23T15:00:00Z","expiresAt":"2026-10-23T16:00:00Z"}]}`,
		"truncated": `{"version":1,"candles":[`,
	} {
		t.Run(name, func(t *testing.T) {
			s := newTestService(&fakeProvider{}, &testClock{t: time.Date(2026, 10, 23, 15, 0, 0, 0, time.UTC)})
			if err := s.LoadCache(strings.NewReader(file)); err == nil {
				t.Fatal("expected an error")
			}
			if n := len(s.candles.Snapshot()); n != 0 {
				t.Fatalf("nothing should be restored, got %d entries", n)
			}
		})
	}
}
