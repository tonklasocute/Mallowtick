package research

import (
	"math"
	"strings"
	"testing"
	"time"

	"github.com/tonklasocute/mallowtick/services/api/internal/market"
)

var ny = func() *time.Location {
	l, err := time.LoadLocation("America/New_York")
	if err != nil {
		panic(err)
	}
	return l
}()

// now is 2026-11-17 3 PM in New York (market open); today is that date.
var (
	now   = time.Date(2026, 11, 17, 15, 0, 0, 0, ny)
	today = "2026-11-17"
)

func f(v float64) *float64 { return &v }
func i64(v int64) *int64   { return &v }

// bars returns n daily bars ending the session before today, closing at close(i).
func bars(n int, closeAt func(i int) float64, volume func(i int) *int64) []market.Candle {
	out := make([]market.Candle, n)
	day := time.Date(2026, 11, 16, 0, 0, 0, 0, ny)
	for i := n - 1; i >= 0; i-- {
		c := closeAt(i)
		out[i] = market.Candle{Time: day, Open: c, High: c * 1.01, Low: c * 0.99, Close: c, Volume: volume(i)}
		day = day.AddDate(0, 0, -1)
	}
	return out
}

func vol(v int64) func(int) *int64 { return func(int) *int64 { return i64(v) } }

func quoteAt(price float64, pct *float64) *market.QuoteResult {
	asOf := now.Add(-time.Minute)
	return &market.QuoteResult{
		Quote:     market.Quote{Symbol: "AAPL", Price: price, ChangePercent: pct, PreviousClose: f(100), AsOf: &asOf, IsMarketOpen: boolp(true)},
		Freshness: market.Freshness{Provider: "finnhub", FetchedAt: asOf},
	}
}

func boolp(b bool) *bool { return &b }

func byType(in []Insight, typ string) *Insight {
	for i := range in {
		if in[i].Type == typ {
			return &in[i]
		}
	}
	return nil
}

func TestEMA(t *testing.T) {
	got := EMA([]float64{1, 2, 3, 4, 5}, 3)
	// Seed: (1+2+3)/3 = 2; then 4*0.5+2*0.5 = 3; then 5*0.5+3*0.5 = 4.
	if !math.IsNaN(got[1]) || got[2] != 2 || got[3] != 3 || got[4] != 4 {
		t.Fatalf("EMA = %v", got)
	}
	if out := EMA([]float64{1, 2}, 3); !math.IsNaN(out[1]) {
		t.Fatal("too few values: no average")
	}
}

func TestBigMoveStatesSizeNotCause(t *testing.T) {
	in := SymbolInsights(SymbolData{Symbol: "AAPL", Quote: quoteAt(96, f(-4.2))}, today, now)
	m := byType(in, "big_move")
	if m == nil || m.Tone != "down" || m.Reliability != ReliabilityHigh || !strings.Contains(m.Explanation, "ไม่ได้บอกสาเหตุ") {
		t.Fatalf("big move = %+v", m)
	}
	if in := SymbolInsights(SymbolData{Symbol: "AAPL", Quote: quoteAt(98, f(-2.9))}, today, now); byType(in, "big_move") != nil {
		t.Fatal("2.9% is under the threshold")
	}
	if in := SymbolInsights(SymbolData{Symbol: "AAPL", Quote: quoteAt(98, nil)}, today, now); len(in) != 0 {
		t.Fatal("no change, no insight")
	}
}

func TestBelowEMAUsesCompletedSessionsAndNeedsEnoughOfThem(t *testing.T) {
	falling := func(i int) float64 { return 200 - float64(i) } // steadily down
	d := SymbolData{Symbol: "AAPL", Daily: bars(120, falling, vol(1000)), DailySource: "twelvedata", Quote: quoteAt(70, f(-0.5))}
	in := byType(SymbolInsights(d, today, now), "below_ema50")
	if in == nil || in.Reliability != ReliabilityMedium || in.Facts[0].Label != "ราคาล่าสุด" {
		t.Fatalf("below EMA = %+v", in)
	}
	if in.Facts[3].Value == nil || *in.Facts[3].Value < 50 {
		t.Fatalf("a steady fall stays below its average for many sessions: %+v", in.Facts[3])
	}
	if got := strings.Join(in.Sources, ","); got != "twelvedata,finnhub,mallowtick" {
		t.Fatalf("sources = %s", got)
	}

	short := SymbolData{Symbol: "AAPL", Daily: bars(99, falling, vol(1000)), DailySource: "twelvedata"}
	if byType(SymbolInsights(short, today, now), "below_ema50") != nil {
		t.Fatal("fewer than 100 completed sessions: no insight")
	}

	// A bar for today (the session in progress) is never treated as completed.
	withToday := append(bars(100, falling, vol(1000)), market.Candle{Time: time.Date(2026, 11, 17, 0, 0, 0, 0, ny), Close: 1})
	if got := completedBars(withToday, today); len(got) != 100 {
		t.Fatalf("completed bars = %d, want 100", len(got))
	}
}

func TestUnusualVolume(t *testing.T) {
	flat := func(int) float64 { return 100 }
	spike := func(i int) *int64 {
		if i == 29 {
			return i64(3_000_000)
		}
		return i64(1_000_000)
	}
	d := SymbolData{Symbol: "AAPL", Daily: bars(30, flat, spike), DailySource: "twelvedata"}
	v := byType(SymbolInsights(d, today, now), "unusual_volume")
	if v == nil || *v.Facts[3].Value != 3 || v.Facts[0].Text != "2026-11-16" {
		t.Fatalf("volume = %+v", v)
	}
	if !strings.Contains(v.Explanation, "ไม่ได้บอกว่าเป็นแรงซื้อหรือแรงขาย") {
		t.Fatal("volume says nothing about buyers or sellers")
	}
	// One missing volume in the window: no average, no insight.
	gap := func(i int) *int64 {
		if i == 15 {
			return nil
		}
		return spike(i)
	}
	if byType(SymbolInsights(SymbolData{Symbol: "AAPL", Daily: bars(30, flat, gap)}, today, now), "unusual_volume") != nil {
		t.Fatal("a gap in volumes must not produce an average")
	}
	// Today's bar (partial during the session) is never compared.
	partial := append(bars(30, flat, vol(1_000_000)), market.Candle{Time: time.Date(2026, 11, 17, 0, 0, 0, 0, ny), Close: 100, Volume: i64(9_000_000)})
	if byType(SymbolInsights(SymbolData{Symbol: "AAPL", Daily: partial}, today, now), "unusual_volume") != nil {
		t.Fatal("today's session must not be compared")
	}
}

func TestEarningsSoonAndResults(t *testing.T) {
	d := SymbolData{
		Symbol: "NVDA", EarningsSource: "finnhub", ResultSource: "finnhub",
		NextEarnings: &market.EarningsEvent{Symbol: "NVDA", Date: "2026-11-19", Hour: "amc", EPSEstimate: f(2.5)},
		LastQuarter: &market.EarningsQuarter{
			EarningsSurprise: market.EarningsSurprise{Year: 2027, Quarter: 2, Actual: f(1.0), Estimate: f(1.1), SurprisePercent: f(-9.09)},
			ReportDate:       "2026-11-01", EPSResult: market.ResultMiss,
		},
	}
	in := SymbolInsights(d, today, now)
	soon, res := byType(in, "earnings_soon"), byType(in, "earnings_result")
	if soon == nil || soon.Title != "NVDA ประกาศงบอีก 2 วัน" {
		t.Fatalf("soon = %+v", soon)
	}
	if res == nil || res.Tone != "down" || res.Title != "NVDA EPS ต่ำกว่าคาด" || res.Completeness != Partial {
		t.Fatalf("result = %+v (partial: no revenue reported)", res)
	}

	d.NextEarnings.Date = "2026-11-30"
	d.LastQuarter.ReportDate = "2026-09-01"
	if in := SymbolInsights(d, today, now); len(in) != 0 {
		t.Fatalf("a report beyond 7 days and a result over 30 days old are not noted: %+v", in)
	}
	d.NextEarnings.Date, d.NextEarnings.EPSActual = "2026-11-17", f(2.6)
	if byType(SymbolInsights(d, today, now), "earnings_soon") != nil {
		t.Fatal("a report that is out is not upcoming")
	}
}

func TestRecentNewsCountsLast24HoursAndCreditsPublishers(t *testing.T) {
	art := func(id string, age time.Duration, source string) market.NewsArticle {
		at := now.Add(-age)
		return market.NewsArticle{ID: id, Headline: "Headline " + id, PublishedAt: at, Provider: "finnhub",
			Sources: []market.NewsSource{{ID: id, Source: source, PublishedAt: at}}}
	}
	d := SymbolData{Symbol: "AAPL", NewsSource: "finnhub", News: []market.NewsArticle{
		art("a", time.Hour, "Reuters"), art("b", 5*time.Hour, "Yahoo"), art("c", 30*time.Hour, "CNBC"),
	}}
	n := byType(SymbolInsights(d, today, now), "news")
	if n == nil || *n.Facts[0].Value != 2 || n.Facts[1].Text != "Headline a" || n.Facts[2].Text != "Reuters, Yahoo" {
		t.Fatalf("news = %+v", n)
	}
	if !strings.Contains(n.Explanation, "ไม่ได้หมายความว่าข่าวนั้นเป็นสาเหตุ") {
		t.Fatal("news insight must not claim causation")
	}
}

func TestNear52WeekHigh(t *testing.T) {
	rising := func(i int) float64 { return 100 + float64(i)*0.1 }
	d := SymbolData{Symbol: "AAPL", Daily: bars(260, rising, vol(1)), DailySource: "twelvedata"}
	if byType(SymbolInsights(d, today, now), "near_52w_high") == nil {
		t.Fatal("a price at the top of its year is near the 52-week high")
	}
	if byType(SymbolInsights(SymbolData{Symbol: "AAPL", Daily: bars(200, rising, vol(1))}, today, now), "near_52w_high") != nil {
		t.Fatal("less than a year of sessions: no 52-week range")
	}
}

func TestMarketInsights(t *testing.T) {
	asOf := now
	in := MarketInsights(MarketData{
		BenchmarkLabels: BenchmarkLabels,
		Benchmarks: []market.QuoteResult{{Quote: market.Quote{Symbol: "SPY", Price: 600, ChangePercent: f(0.71), AsOf: &asOf},
			Freshness: market.Freshness{Provider: "finnhub"}}},
		Sectors: &market.SectorsResult{
			Sectors: []market.SectorPerformance{
				{Sector: "technology", Returns: market.PriceReturns{Day: f(1.2)}},
				{Sector: "energy", Returns: market.PriceReturns{Day: f(-0.8)}},
				{Sector: "utilities", Returns: market.PriceReturns{Day: nil}},
			},
			Freshness: market.Freshness{Provider: "finnhub", FetchedAt: now},
		},
	})
	spy, breadth := byType(in, "index_move"), byType(in, "sector_breadth")
	if ranked := Rank(append(in, Insight{Type: "index_move", Symbol: "DIA", Priority: 94})); ranked[0].Symbol != "SPY" {
		t.Fatalf("benchmarks keep their configured order: %+v", ranked)
	}
	if spy == nil || spy.Title != "SPY (S&P 500) +0.71%" || !strings.Contains(spy.Explanation, "ไม่ใช่ค่าดัชนี") {
		t.Fatalf("index = %+v", spy)
	}
	if breadth == nil || breadth.Title != "กลุ่มอุตสาหกรรมบวก 1 จาก 2 กลุ่ม" || breadth.Completeness != Partial ||
		!strings.Contains(breadth.Explanation, "เทคโนโลยี (+1.20%)") {
		t.Fatalf("breadth = %+v", breadth)
	}
}

func TestRankIsStable(t *testing.T) {
	r := Rank([]Insight{{Priority: 1, Symbol: "B"}, {Priority: 5, Symbol: "A"}, {Priority: 1, Symbol: "A"}})
	if r[0].Symbol != "A" || r[0].Priority != 5 || r[1].Symbol != "A" || r[2].Symbol != "B" {
		t.Fatalf("rank = %+v", r)
	}
}
