package market

import (
	"context"
	"testing"
	"time"

	"github.com/tonklasocute/mallowtick/services/api/internal/supportresistance"
)

func newLatencyService(p Provider, clk *testClock, vendors map[string]Latency) *Service {
	return NewService(p, ServiceConfig{
		Latency: LatencyDelayed, VendorLatency: vendors,
		QuoteTTL: time.Minute, QuoteTTLClosed: 15 * time.Minute, StaleRetention: 24 * time.Hour,
		ProviderTimeout: time.Second, Levels: supportresistance.DefaultConfig(), Now: clk.now,
	})
}

func TestLatencyDefaultsToTheGlobalDeclaration(t *testing.T) {
	clk := &testClock{t: time.Unix(0, 0)}
	s := newLatencyService(Composite{
		QuoteSource: namedFake{&fakeProvider{quotes: map[Symbol]Quote{"AAPL": quote("AAPL", 1, true)}}, "finnhub"},
		BarSource:   namedFake{&fakeProvider{candles: CandleSeries{Symbol: "AAPL"}}, "twelvedata"},
	}, clk, nil)
	q, err := s.Quote(context.Background(), "AAPL")
	if err != nil || q.Freshness.Latency != LatencyDelayed {
		t.Fatalf("without per-vendor latencies the global one applies: %+v %v", q.Freshness, err)
	}
	if got := s.ProviderInfo(); got.Latency != LatencyDelayed || got.Sources[KindCandles].Latency != LatencyDelayed {
		t.Fatalf("provider info = %+v", got)
	}
}

func TestEachVendorKeepsItsOwnLatency(t *testing.T) {
	clk := &testClock{t: time.Unix(0, 0)}
	s := newLatencyService(Composite{
		QuoteSource: namedFake{&fakeProvider{quotes: map[Symbol]Quote{"AAPL": quote("AAPL", 1, true)}}, "finnhub"},
		BarSource:   namedFake{&fakeProvider{candles: CandleSeries{Symbol: "AAPL"}}, "twelvedata"},
	}, clk, map[string]Latency{"finnhub": LatencyRealtime, "twelvedata": LatencyUnknown})
	ctx := context.Background()

	q, err := s.Quote(ctx, "AAPL")
	if err != nil || q.Freshness.Latency != LatencyRealtime {
		t.Fatalf("quote latency = %+v %v, want finnhub's realtime", q.Freshness, err)
	}
	c, err := s.Candles(ctx, "AAPL", Range1W)
	if err != nil || c.Freshness.Latency != LatencyUnknown {
		t.Fatalf("candles must not inherit the quote vendor's realtime: %+v %v", c.Freshness, err)
	}
	info := s.ProviderInfo()
	if info.Sources[KindQuotes].Latency != LatencyRealtime || info.Sources[KindCandles].Latency != LatencyUnknown {
		t.Fatalf("sources = %+v", info.Sources)
	}
}

func TestBarFromAnotherVendorsQuoteNeedsBothLatencies(t *testing.T) {
	ny := newYork(t)
	asOf := time.Date(2026, 11, 6, 11, 4, 0, 0, ny)
	open, high, low := 188.0, 191.0, 187.5
	q := Quote{Symbol: "AAPL", Price: 190.5, Open: &open, High: &high, Low: &low, IsMarketOpen: boolPtr(true), AsOf: &asOf}
	for _, tc := range []struct {
		name    string
		vendors map[string]Latency
		want    Latency
	}{
		{"same declaration", map[string]Latency{"finnhub": LatencyDelayed, "twelvedata": LatencyDelayed}, LatencyDelayed},
		{"different declarations", map[string]Latency{"finnhub": LatencyRealtime, "twelvedata": LatencyDelayed}, LatencyUnknown},
	} {
		t.Run(tc.name, func(t *testing.T) {
			clk := &testClock{t: time.Date(2026, 11, 6, 11, 0, 0, 0, ny)}
			s := newLatencyService(Composite{
				QuoteSource: namedFake{&fakeProvider{quotes: map[Symbol]Quote{"AAPL": q}}, "finnhub"},
				BarSource:   namedFake{&fakeProvider{candles: nyDailySeries(nyDailyBars(ny, 30, asOf))}, "twelvedata"},
			}, clk, tc.vendors)
			ctx := context.Background()
			if _, err := s.Candles(ctx, "AAPL", Range3M); err != nil {
				t.Fatal(err)
			}
			clk.advance(5 * time.Minute)
			if _, err := s.Quote(ctx, "AAPL"); err != nil {
				t.Fatal(err)
			}
			c, err := s.Candles(ctx, "AAPL", Range3M)
			if err != nil || c.Freshness.Provider != "twelvedata+finnhub" || c.Freshness.Latency != tc.want {
				t.Fatalf("freshness = %+v %v, want latency %s", c.Freshness, err, tc.want)
			}
		})
	}
}
