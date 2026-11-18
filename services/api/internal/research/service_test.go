package research

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/tonklasocute/mallowtick/services/api/internal/market"
)

// fakeMarket serves canned data and counts the calls that would reach a vendor.
type fakeMarket struct {
	mu           sync.Mutex
	daily        map[market.Symbol]market.CandleSeries
	details      map[market.Symbol]market.EarningsDetailResult
	candleCalls  atomic.Int32
	detailCalls  atomic.Int32
	slowCandles  time.Duration
	quotesErr    error
	news         map[market.Symbol]bool
	newsAsked    []market.Symbol
	sectorsErr   error
	fundamentals map[market.Symbol]market.FundamentalsResult
}

func newFakeMarket() *fakeMarket {
	return &fakeMarket{
		daily:        map[market.Symbol]market.CandleSeries{},
		details:      map[market.Symbol]market.EarningsDetailResult{},
		fundamentals: map[market.Symbol]market.FundamentalsResult{},
	}
}

func (m *fakeMarket) Today() string { return today }
func (m *fakeMarket) Quotes(_ context.Context, syms []market.Symbol) (market.QuoteBatch, error) {
	if m.quotesErr != nil {
		return market.QuoteBatch{}, m.quotesErr
	}
	b := market.QuoteBatch{Unavailable: []market.UnavailableSymbol{}}
	for _, s := range syms {
		q := quoteAt(100, f(-4))
		q.Symbol = string(s)
		b.Quotes = append(b.Quotes, *q)
	}
	return b, nil
}
func (m *fakeMarket) Overview(context.Context) (market.Overview, error) {
	q := quoteAt(600, f(0.5))
	q.Symbol = "SPY"
	return market.Overview{Benchmarks: []market.QuoteResult{*q}}, nil
}
func (m *fakeMarket) Sectors(context.Context) (market.SectorsResult, error) {
	return market.SectorsResult{}, m.sectorsErr
}
func (m *fakeMarket) CachedDaily(s market.Symbol) (market.CandleSeries, market.Freshness, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	d, ok := m.daily[s]
	return d, market.Freshness{Provider: "twelvedata"}, ok
}
func (m *fakeMarket) Candles(ctx context.Context, s market.Symbol, _ market.Range) (market.CandlesResult, error) {
	m.candleCalls.Add(1)
	if m.slowCandles > 0 {
		select {
		case <-time.After(m.slowCandles):
		case <-ctx.Done():
			return market.CandlesResult{}, ctx.Err()
		}
	}
	m.mu.Lock()
	m.daily[s] = market.CandleSeries{Candles: bars(120, func(i int) float64 { return 200 - float64(i) }, vol(1000))}
	m.mu.Unlock()
	return market.CandlesResult{}, nil
}
func (m *fakeMarket) EarningsCalendar(context.Context, string, string, []market.Symbol) (market.EarningsCalendarResult, error) {
	return market.EarningsCalendarResult{Events: []market.EarningsEvent{{Symbol: "AAPL", Date: "2026-11-18", Hour: "bmo"}},
		Freshness: market.Freshness{Provider: "finnhub"}}, nil
}
func (m *fakeMarket) CachedEarningsDetail(s market.Symbol) (market.EarningsDetailResult, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	d, ok := m.details[s]
	return d, ok
}
func (m *fakeMarket) EarningsDetail(_ context.Context, s market.Symbol) (market.EarningsDetailResult, error) {
	m.detailCalls.Add(1)
	d := market.EarningsDetailResult{Symbol: s, Quarters: []market.EarningsQuarter{}, Freshness: market.Freshness{Provider: "finnhub"}}
	m.mu.Lock()
	m.details[s] = d
	m.mu.Unlock()
	return d, nil
}

// News fetches (caches) at most five of the asked symbols, like the market service.
func (m *fakeMarket) News(_ context.Context, q market.NewsQuery) (market.NewsResult, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.news == nil {
		m.news = map[market.Symbol]bool{}
	}
	res := market.NewsResult{Unavailable: []market.UnavailableSymbol{}}
	fetched := 0
	for _, s := range q.Symbols {
		m.newsAsked = append(m.newsAsked, s)
		if m.news[s] {
			continue
		}
		if fetched < 5 {
			m.news[s] = true
			fetched++
		} else {
			res.Unavailable = append(res.Unavailable, market.UnavailableSymbol{Symbol: s, Reason: "rate_limited"})
		}
	}
	return res, nil
}
func (m *fakeMarket) CachedCompanyNews(s market.Symbol) ([]market.NewsArticle, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return nil, m.news[s]
}
func (m *fakeMarket) Fundamentals(_ context.Context, s market.Symbol) (market.FundamentalsResult, error) {
	if r, ok := m.fundamentals[s]; ok {
		return r, nil
	}
	return market.FundamentalsResult{}, market.ErrNotFound
}
func (m *fakeMarket) Recommendations(_ context.Context, s market.Symbol) (market.RecommendationsResult, error) {
	return market.RecommendationsResult{Symbol: s, Trends: []market.RecommendationTrend{{Period: "2026-11-01", Buy: 3}},
		Freshness: market.Freshness{Provider: "finnhub"}}, nil
}

func symbols(n int) []market.Symbol {
	out := make([]market.Symbol, n)
	for i := range out {
		out[i] = market.Symbol(fmt.Sprintf("S%d", i))
	}
	return out
}

func TestInsightsFetchOnlyAFewMissingItemsPerRequest(t *testing.T) {
	m := newFakeMarket()
	s := NewService(m, func() time.Time { return now })
	res, err := s.Insights(context.Background(), symbols(8))
	if err != nil {
		t.Fatal(err)
	}
	if m.candleCalls.Load() != candleFetches || m.detailCalls.Load() != detailFetches {
		t.Fatalf("calls: candles %d, details %d", m.candleCalls.Load(), m.detailCalls.Load())
	}
	deferred := 0
	for _, c := range res.Coverage {
		for _, miss := range c.Missing {
			if miss.Data == DataTechnicals && miss.Reason == "rate_limited" {
				deferred++
			}
		}
	}
	if deferred != 8-candleFetches {
		t.Fatalf("deferred technicals = %d, want %d: %+v", deferred, 8-candleFetches, res.Coverage)
	}
	// Every symbol fell over 3% in the fake quotes; those fetched also sit below their EMA.
	if n := countType(res.Insights, "big_move"); n != 8 {
		t.Fatalf("big moves = %d", n)
	}
	if n := countType(res.Insights, "below_ema50"); n != candleFetches {
		t.Fatalf("EMA insights = %d, want only for symbols with bars", n)
	}
	// The next request uses the cache and fetches the next few.
	if _, err := s.Insights(context.Background(), symbols(8)); err != nil {
		t.Fatal(err)
	}
	if m.candleCalls.Load() != 2*candleFetches {
		t.Fatalf("second request candle calls = %d", m.candleCalls.Load())
	}
}

func countType(in []Insight, typ string) int {
	n := 0
	for _, i := range in {
		if i.Type == typ {
			n++
		}
	}
	return n
}

func TestSlowFetchesDoNotHoldTheRequest(t *testing.T) {
	m := newFakeMarket()
	m.slowCandles = time.Hour
	s := NewService(m, func() time.Time { return now })
	s.fetchWait = 50 * time.Millisecond
	start := time.Now()
	res, err := s.Insights(context.Background(), symbols(1))
	if err != nil {
		t.Fatal(err)
	}
	if time.Since(start) > 2*time.Second {
		t.Fatalf("request took %v", time.Since(start))
	}
	if len(res.Coverage) != 1 || res.Coverage[0].Missing[0] != (Missing{DataTechnicals, "timeout"}) {
		t.Fatalf("coverage = %+v", res.Coverage)
	}
}

func TestBriefingCombinesMarketAndSymbols(t *testing.T) {
	m := newFakeMarket()
	m.sectorsErr = market.ErrNotConfigured
	b, err := NewService(m, func() time.Time { return now }).Briefing(context.Background(), []market.Symbol{"AAPL"})
	if err != nil {
		t.Fatal(err)
	}
	if len(b.Market) != 1 || b.Market[0].Type != "index_move" {
		t.Fatalf("market = %+v", b.Market)
	}
	if len(b.ThingsToWatch) == 0 || b.ThingsToWatch[0].Type != "earnings_soon" {
		t.Fatalf("an earnings report tomorrow leads: %+v", b.ThingsToWatch)
	}
	if b.Coverage[0].Symbol != "" || b.Coverage[0].Missing[0] != (Missing{DataSectors, "provider_not_configured"}) {
		t.Fatalf("market coverage = %+v", b.Coverage)
	}
	if b.Disclaimer == "" {
		t.Fatal("every briefing carries the disclaimer")
	}
}

func TestCompare(t *testing.T) {
	m := newFakeMarket()
	m.fundamentals["AAPL"] = market.FundamentalsResult{Fundamentals: market.Fundamentals{Symbol: "AAPL", Industry: "Technology"},
		Freshness: market.Freshness{Provider: "finnhub"}}
	c, err := NewService(m, nil).Compare(context.Background(), []market.Symbol{"AAPL", "XYZ"})
	if err != nil {
		t.Fatal(err)
	}
	if len(c.Items) != 2 || c.Items[0].Fundamentals == nil || c.Items[0].Ratings == nil || c.Items[0].Price == nil {
		t.Fatalf("items = %+v", c.Items)
	}
	if c.Items[1].Fundamentals != nil || c.Items[1].Missing[0] != (Missing{"fundamentals", "not_found"}) {
		t.Fatalf("missing data is reported, not filled: %+v", c.Items[1])
	}

	m.quotesErr = market.ErrNotConfigured
	if _, err := NewService(m, nil).Compare(context.Background(), []market.Symbol{"AAPL", "MSFT"}); !errors.Is(err, market.ErrNotConfigured) {
		t.Fatalf("got %v, want ErrNotConfigured", err)
	}
}

// The real market service satisfies the interface.
var _ Market = (*market.Service)(nil)

func TestEverySymbolsNewsArrivesOverAFewRequests(t *testing.T) {
	m := newFakeMarket()
	s := NewService(m, func() time.Time { return now })
	syms := symbols(25)
	newsGaps := func(res InsightsResult) int {
		n := 0
		for _, c := range res.Coverage {
			for _, miss := range c.Missing {
				if miss.Data == DataNews {
					n++
				}
			}
		}
		return n
	}
	var gaps []int
	for range 6 {
		res, err := s.Insights(context.Background(), syms)
		if err != nil {
			t.Fatal(err)
		}
		gaps = append(gaps, newsGaps(res))
	}
	// 25 symbols, five fetched per request: none missing after the fifth.
	if gaps[0] != 20 || gaps[4] != 0 || gaps[5] != 0 {
		t.Fatalf("news gaps per request = %v; a symbol past the first ten must still be fetched", gaps)
	}
}

func TestStaleQuoteIsNotUsedAsTheLatestPrice(t *testing.T) {
	falling := func(i int) float64 { return 200 - float64(i) }
	q := quoteAt(70, f(-0.5))
	q.Freshness.Stale = true
	in := byType(SymbolInsights(SymbolData{Symbol: "AAPL", Daily: bars(120, falling, vol(1000)), DailySource: "twelvedata", Quote: q}, today, now), "below_ema50")
	if in == nil || in.Facts[0].Label != "ราคาปิดล่าสุด" {
		t.Fatalf("a stale quote must leave the last close in its place: %+v", in)
	}
	q.ChangePercent = f(-5)
	if m := byType(SymbolInsights(SymbolData{Symbol: "AAPL", Quote: q}, today, now), "big_move"); m == nil || m.Completeness != Partial {
		t.Fatalf("a stale day move is still reported, as partial: %+v", m)
	}
}
