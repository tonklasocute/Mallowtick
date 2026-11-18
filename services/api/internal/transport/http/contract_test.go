package httptransport

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/tonklasocute/mallowtick/services/api/internal/market"
	"github.com/tonklasocute/mallowtick/services/api/internal/research"
	"github.com/tonklasocute/mallowtick/services/api/internal/resilience"
	"github.com/tonklasocute/mallowtick/services/api/internal/supportresistance"
)

// The contract tests pin every endpoint's JSON. The web app type-checks the
// same files against its TypeScript types (apps/web/tests/api/contract.test.ts),
// so a change on either side shows up as a failing test. After an intended,
// backward-compatible change, regenerate them with:
//
//	go test ./internal/transport/http -run TestContract -update
var update = flag.Bool("update", false, "rewrite the contract fixtures in testdata/contract")

var (
	contractTime = time.Date(2026, 11, 17, 21, 0, 0, 0, time.UTC)
	contractNY   = time.FixedZone("EST", -5*60*60)
)

func fp(v float64) *float64 { return &v }
func ip(v int64) *int64     { return &v }
func bp(v bool) *bool       { return &v }
func tp(t time.Time) *time.Time {
	return &t
}

func contractFreshness(provider string) market.Freshness {
	return market.Freshness{Provider: provider, Latency: market.LatencyDelayed, AsOf: tp(contractTime),
		FetchedAt: contractTime.Add(time.Minute), Stale: false}
}

func contractQuote(sym string) market.QuoteResult {
	return market.QuoteResult{
		Quote: market.Quote{
			Symbol: sym, Name: "Apple Inc", Exchange: "NASDAQ", Currency: "USD",
			Logo:  "https://static2.finnhub.io/file/publicdatany/finnhubimage/stock_logo/AAPL.png",
			Price: 347.73, Open: fp(349.12), High: fp(351.73), Low: fp(345.75), PreviousClose: fp(348.22),
			Change: fp(-0.49), ChangePercent: fp(-0.1407), Volume: ip(39496500),
			FiftyTwoWeek: &market.Range52{Low: 243.42, High: 351.73}, IsMarketOpen: bp(false), AsOf: tp(contractTime),
		},
		Freshness: contractFreshness("finnhub"),
	}
}

func contractInstrument() market.Instrument {
	return market.Instrument{Symbol: "AAPL", Name: "Apple Inc", Exchange: "NASDAQ", MICCode: "XNGS",
		Currency: "USD", Type: "Common Stock", Country: "United States",
		Logo: "https://static2.finnhub.io/file/publicdatany/finnhubimage/stock_logo/AAPL.png"}
}

func contractCandle(day int) market.Candle {
	return market.Candle{Time: time.Date(2026, 11, day, 0, 0, 0, 0, contractNY),
		Open: 340, High: 350, Low: 338, Close: 347.73, Volume: ip(41000000)}
}

// contractService answers every call with fully populated data, so the
// fixtures show every field the API can send.
type contractService struct{}

func (contractService) ProviderInfo() market.ProviderInfo {
	src := func(name string) market.SourceInfo {
		return market.SourceInfo{Name: name, Configured: true, Latency: market.LatencyDelayed}
	}
	return market.ProviderInfo{Name: "finnhub+twelvedata", Configured: true, Latency: market.LatencyDelayed,
		Sources: map[market.DataKind]market.SourceInfo{
			market.KindQuotes: src("finnhub"), market.KindSearch: src("finnhub"), market.KindCandles: src("twelvedata"),
			market.KindStatus: src("twelvedata"), market.KindEarnings: src("finnhub"),
			market.KindFundamentals: src("finnhub"), market.KindFX: src("twelvedata"),
		},
		Vendors: map[string]resilience.Stats{
			"finnhub":    {State: resilience.Closed, Calls: 120, Failures: 0},
			"twelvedata": {State: resilience.Open, Calls: 40, Failures: 5, ConsecutiveFailures: 5, LastFailureAt: tp(contractTime), LastFailure: "http_502"},
		}}
}
func (contractService) Search(context.Context, string) ([]market.Instrument, error) {
	return []market.Instrument{contractInstrument()}, nil
}
func (contractService) Instrument(context.Context, market.Symbol) (market.Instrument, error) {
	return contractInstrument(), nil
}
func (contractService) Quote(_ context.Context, sym market.Symbol) (market.QuoteResult, error) {
	return contractQuote(string(sym)), nil
}
func (contractService) Quotes(context.Context, []market.Symbol) (market.QuoteBatch, error) {
	return market.QuoteBatch{Quotes: []market.QuoteResult{contractQuote("AAPL")},
		Unavailable: []market.UnavailableSymbol{{Symbol: "MSFT", Reason: "rate_limited"}}}, nil
}
func (contractService) Candles(_ context.Context, sym market.Symbol, rng market.Range) (market.CandlesResult, error) {
	return market.CandlesResult{
		CandleSeries: market.CandleSeries{Symbol: string(sym), Interval: market.Interval1Day, Currency: "USD",
			ExchangeTimezone: "America/New_York", Candles: []market.Candle{contractCandle(17)}},
		Warmup: []market.Candle{contractCandle(16)}, Range: rng, Freshness: contractFreshness("twelvedata+finnhub"),
	}, nil
}
func (contractService) Levels(_ context.Context, sym market.Symbol, rng market.Range) (market.LevelsResult, error) {
	return market.LevelsResult{
		Symbol: sym, Range: rng, Interval: market.Interval1Day,
		Result: supportresistance.Result{
			Status: supportresistance.StatusOK,
			Levels: []supportresistance.Level{{Type: "resistance", Price: 351.2, ZoneLow: 350.8, ZoneHigh: 351.6,
				Touches: 3, Strength: 0.72, FirstTouchAt: contractTime.Add(-72 * time.Hour), LastTouchAt: contractTime}},
			ReferencePrice: 347.73, ATR: 5.21, Tolerance: 2.6, CandlesUsed: 63, SwingHighs: 8, SwingLows: 7, AsOf: contractTime,
		},
		Method:     market.LevelsMethod{Name: "swing-cluster-v1", Description: "…", Parameters: supportresistance.DefaultConfig()},
		ComputedAt: contractTime, Disclaimer: "…", Freshness: contractFreshness("twelvedata"),
	}, nil
}
func (contractService) MarketStatus(context.Context) (market.StatusResult, error) {
	return market.StatusResult{MarketStatus: market.MarketStatus{Exchange: "XNYS", Name: "NYSE", IsOpen: false,
		OpensInSeconds: ip(45000), ClosesInSeconds: nil}, Freshness: contractFreshness("twelvedata")}, nil
}
func (contractService) Overview(context.Context) (market.Overview, error) {
	return market.Overview{Benchmarks: []market.QuoteResult{contractQuote("SPY")}, Popular: []market.QuoteResult{contractQuote("AAPL")},
		Unavailable: []market.UnavailableSymbol{{Symbol: "DIA", Reason: "rate_limited", Group: market.GroupBenchmark}}}, nil
}
func (contractService) Sectors(context.Context) (market.SectorsResult, error) {
	r := market.PriceReturns{Day: fp(0.71), Week: fp(-0.85), Quarter: fp(2.85), YTD: fp(11.45), Year: fp(13.13)}
	return market.SectorsResult{
		Benchmark:   &market.SectorPerformance{Symbol: "SPY", Returns: r},
		Sectors:     []market.SectorPerformance{{Sector: "technology", Symbol: "XLK", Returns: r}},
		Unavailable: []market.UnavailableSymbol{{Symbol: "XLE", Reason: "rate_limited"}},
		Freshness:   contractFreshness("finnhub"),
	}, nil
}
func (contractService) ExchangeRate(context.Context) (market.ExchangeRateResult, error) {
	return market.ExchangeRateResult{ExchangeRate: market.ExchangeRate{Pair: "USD/THB", Rate: 33.7691, AsOf: tp(contractTime)},
		Freshness: contractFreshness("twelvedata")}, nil
}
func (contractService) NextEarnings(_ context.Context, sym market.Symbol) (market.EarningsResult, error) {
	return market.EarningsResult{Symbol: sym, Next: &market.EarningsEvent{Symbol: string(sym), Date: "2027-01-28", Hour: "amc",
		Quarter: 1, Year: 2027, EPSEstimate: fp(2.35), RevenueEstimate: fp(124e9)}, Freshness: contractFreshness("finnhub")}, nil
}
func (contractService) EarningsHistory(_ context.Context, sym market.Symbol) (market.EarningsHistoryResult, error) {
	return market.EarningsHistoryResult{Symbol: sym, Quarters: []market.EarningsSurprise{{Period: "2026-09-30", Year: 2026,
		Quarter: 4, Actual: fp(2.1), Estimate: fp(2.0263), Surprise: fp(0.0737), SurprisePercent: fp(3.637)}},
		Freshness: contractFreshness("finnhub")}, nil
}
func (contractService) Fundamentals(_ context.Context, sym market.Symbol) (market.FundamentalsResult, error) {
	m := market.KeyMetrics{MarketCap: fp(3.2e12), EnterpriseValue: fp(3.3e12), PE: fp(35.1), PS: fp(8.4), PB: fp(52.3),
		EPS: fp(7.4), RevenueGrowthYoY: fp(6.1), RevenueGrowth5Y: fp(8.2), EPSGrowthYoY: fp(10.2), GrossMargin: fp(46.5),
		OperatingMargin: fp(31.2), NetMargin: fp(24.3), ROE: fp(151.3), CurrentRatio: fp(0.87), DebtToEquity: fp(1.5),
		DividendYield: fp(0.45), PayoutRatio: fp(15.1), Beta: fp(1.2), PriceReturnYTD: fp(18.2), PriceReturn1Y: fp(22.4),
		SP500ReturnYTD: fp(11.4), SP500Return1Y: fp(13.1), FiftyTwoWeekHigh: fp(351.73), FiftyTwoWeekLow: fp(243.42),
		FiftyTwoWeekHighDate: "2026-11-12", FiftyTwoWeekLowDate: "2026-04-08"}
	return market.FundamentalsResult{Fundamentals: market.Fundamentals{Symbol: string(sym), Industry: "Technology",
		Country: "US", IPODate: "1980-12-12", Website: "https://www.apple.com/", SharesOutstanding: fp(14.8e9), Metrics: m},
		Freshness: contractFreshness("finnhub")}, nil
}
func (contractService) Recommendations(_ context.Context, sym market.Symbol) (market.RecommendationsResult, error) {
	return market.RecommendationsResult{Symbol: sym, Trends: []market.RecommendationTrend{{Period: "2026-11-01", StrongBuy: 14,
		Buy: 23, Hold: 12, Sell: 1, StrongSell: 0}}, Freshness: contractFreshness("finnhub")}, nil
}

func contractEvent(date string, reported bool) market.EarningsEvent {
	ev := market.EarningsEvent{Symbol: "AAPL", Name: "Apple Inc",
		Logo: "https://static2.finnhub.io/file/publicdatany/finnhubimage/stock_logo/AAPL.png",
		Date: date, Hour: "amc", Quarter: 1, Year: 2027, EPSEstimate: fp(2.9588), RevenueEstimate: fp(138.4e9)}
	if reported {
		ev.Quarter, ev.Year, ev.EPSActual, ev.RevenueActual = 4, 2026, fp(2.1), fp(114.477e9)
	}
	return ev
}

func (contractService) Today() string { return "2026-11-18" }
func (contractService) EarningsCalendar(_ context.Context, from, to string, _ []market.Symbol) (market.EarningsCalendarResult, error) {
	return market.EarningsCalendarResult{From: from, To: to, Today: "2026-11-18",
		Events:    []market.EarningsEvent{contractEvent("2026-11-02", true), contractEvent("2027-01-27", false)},
		Truncated: false, Freshness: contractFreshness("finnhub")}, nil
}
func (contractService) SymbolEarnings(_ context.Context, sym market.Symbol) (market.SymbolEarningsResult, error) {
	next, last := contractEvent("2027-01-27", false), contractEvent("2026-11-02", true)
	return market.SymbolEarningsResult{Symbol: sym, Today: "2026-11-18", Next: &next, Last: &last,
		Freshness: contractFreshness("finnhub")}, nil
}
func (contractService) EarningsDetail(_ context.Context, sym market.Symbol) (market.EarningsDetailResult, error) {
	q := market.EarningsQuarter{
		EarningsSurprise: market.EarningsSurprise{Period: "2026-09-30", Year: 2026, Quarter: 4, Actual: fp(2.1),
			Estimate: fp(2.0263), Surprise: fp(0.0737), SurprisePercent: fp(3.637)},
		ReportDate: "2026-11-02", Hour: "amc", EPSResult: market.ResultBeat,
		RevenueActual: fp(114.477e9), RevenueEstimate: fp(115.66e9), RevenueSurprisePercent: fp(-1.02), RevenueResult: market.ResultMiss,
	}
	return market.EarningsDetailResult{Symbol: sym, Quarters: []market.EarningsQuarter{q},
		EPSRecord: market.EarningsRecord{Compared: 1, Beats: 1}, Freshness: contractFreshness("finnhub")}, nil
}

func contractArticle() market.NewsArticle {
	published := contractTime.Add(-2 * time.Hour)
	return market.NewsArticle{
		ID: "fh-143886409", Headline: "Apple supplier raises outlook", Summary: "The supplier said demand for…",
		URL: "https://finnhub.io/api/news?id=658d34eb", Source: "Yahoo", PublishedAt: published, Category: "company",
		Related: []string{"AAPL", "MSFT"}, Provider: "finnhub",
		Sources: []market.NewsSource{
			{ID: "fh-143886409", Source: "Yahoo", URL: "https://finnhub.io/api/news?id=658d34eb", PublishedAt: published},
			{ID: "fh-143886777", Source: "Benzinga", URL: "https://finnhub.io/api/news?id=77aa01", PublishedAt: published.Add(time.Hour)},
		},
	}
}

func (contractService) News(_ context.Context, q market.NewsQuery) (market.NewsResult, error) {
	return market.NewsResult{Articles: []market.NewsArticle{contractArticle()}, Page: q.Page, Limit: q.Limit, Total: 41,
		HasMore: true, Unavailable: []market.UnavailableSymbol{{Symbol: "TSLA", Reason: "rate_limited"}},
		Freshness: contractFreshness("finnhub")}, nil
}
func (contractService) Article(context.Context, string) (market.NewsArticle, error) {
	return contractArticle(), nil
}

func contractInsight() research.Insight {
	return research.Insight{
		ID: "below_ema50:AAPL:2026-11-17", Type: "below_ema50", Scope: research.ScopeSymbol, Symbol: "AAPL",
		Title: "AAPL ต่ำกว่าเส้น EMA 50 วัน", Explanation: "…", Method: "EMA 50 วันจากราคาปิดรายวัน",
		Facts: []research.Fact{
			{Label: "ราคาล่าสุด", Value: fp(347.73), Unit: research.UnitUSD},
			{Label: "เซสชัน", Text: "2026-11-16", Unit: research.UnitDate},
		},
		Sources: []string{"twelvedata", "finnhub", "mallowtick"}, AsOf: tp(contractTime),
		Completeness: research.Complete, Reliability: research.ReliabilityMedium, Tone: "down", Priority: 45,
	}
}

type contractResearch struct{}

func (contractResearch) Briefing(context.Context, []market.Symbol) (research.Briefing, error) {
	in := contractInsight()
	return research.Briefing{Today: "2026-11-17", GeneratedAt: contractTime, Market: []research.Insight{in},
		Insights: []research.Insight{in}, ThingsToWatch: []research.Insight{in},
		Coverage:   []research.Coverage{{Symbol: "MSFT", Missing: []research.Missing{{Data: research.DataTechnicals, Reason: "rate_limited"}}}},
		Disclaimer: research.Disclaimer}, nil
}
func (contractResearch) Insights(context.Context, []market.Symbol) (research.InsightsResult, error) {
	return research.InsightsResult{Today: "2026-11-17", GeneratedAt: contractTime, Insights: []research.Insight{contractInsight()},
		Coverage: []research.Coverage{}, Disclaimer: research.Disclaimer}, nil
}
func (contractResearch) Compare(context.Context, []market.Symbol) (research.Comparison, error) {
	f, _ := contractService{}.Fundamentals(context.Background(), "AAPL")
	d, _ := contractService{}.EarningsDetail(context.Background(), "AAPL")
	r, _ := contractService{}.Recommendations(context.Background(), "AAPL")
	rec := d.EPSRecord
	return research.Comparison{GeneratedAt: contractTime, Disclaimer: research.Disclaimer, Items: []research.CompareItem{{
		Symbol: "AAPL", Name: "Apple Inc", Logo: "https://static2.finnhub.io/file/publicdatany/finnhubimage/stock_logo/AAPL.png",
		Currency: "USD", Price: fp(347.73), ChangePercent: fp(-0.14), AsOf: tp(contractTime), Fundamentals: &f.Fundamentals,
		EPSRecord: &rec, LastQuarter: &d.Quarters[0], Ratings: &r.Trends[0], Sources: []string{"finnhub"},
		Missing: []research.Missing{{Data: "ratings", Reason: "rate_limited"}},
	}}}, nil
}

// contractCases are the endpoints and the fixture each response is pinned to.
var contractCases = []struct{ name, path string }{
	{"health", "/api/v1/health"},
	{"market-status", "/api/v1/market/status"},
	{"market-overview", "/api/v1/market/overview"},
	{"market-sectors", "/api/v1/market/sectors"},
	{"fx-usd-thb", "/api/v1/fx/usd-thb"},
	{"stocks-search", "/api/v1/stocks/search?q=apple"},
	{"stocks-quotes", "/api/v1/stocks/quotes?symbols=AAPL,MSFT"},
	{"stock-instrument", "/api/v1/stocks/AAPL"},
	{"stock-quote", "/api/v1/stocks/AAPL/quote"},
	{"stock-candles", "/api/v1/stocks/AAPL/candles?range=1m&warmup=true"},
	{"stock-levels", "/api/v1/stocks/AAPL/levels?range=3m"},
	{"stock-earnings", "/api/v1/stocks/AAPL/earnings"},
	{"stock-earnings-history", "/api/v1/stocks/AAPL/earnings/history"},
	{"stock-fundamentals", "/api/v1/stocks/AAPL/fundamentals"},
	{"stock-recommendations", "/api/v1/stocks/AAPL/recommendations"},
	{"earnings-calendar", "/api/v1/earnings/calendar?from=2026-11-01&to=2026-11-30&symbols=AAPL"},
	{"earnings-symbol", "/api/v1/earnings/AAPL"},
	{"earnings-symbol-history", "/api/v1/earnings/AAPL/history"},
	{"news", "/api/v1/news?symbols=AAPL,MSFT,TSLA&page=1&limit=20"},
	{"news-article", "/api/v1/news/fh-143886409"},
	{"research-briefing", "/api/v1/research/briefing?symbols=AAPL,MSFT"},
	{"research-insights", "/api/v1/research/insights?symbols=AAPL"},
	{"research-compare", "/api/v1/research/compare?symbols=AAPL,MSFT"},
	{"error-invalid-request", "/api/v1/stocks/search?q="},
}

func TestContract(t *testing.T) {
	for _, tc := range contractCases {
		t.Run(tc.name, func(t *testing.T) {
			rec, _ := doWith(t, contractService{}, contractResearch{}, http.MethodGet, tc.path, nil)
			var pretty bytes.Buffer
			if err := json.Indent(&pretty, rec.Body.Bytes(), "", "  "); err != nil {
				t.Fatal(err)
			}
			pretty.WriteByte('\n')
			got := bytes.ReplaceAll(pretty.Bytes(), []byte(rec.Header().Get("X-Request-ID")), []byte("request-id"))
			path := filepath.Join("testdata", "contract", tc.name+".json")
			if *update {
				if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(path, got, 0o644); err != nil {
					t.Fatal(err)
				}
				return
			}
			want, err := os.ReadFile(path)
			if err != nil {
				t.Fatalf("%v (run with -update to create it)", err)
			}
			if !bytes.Equal(got, want) {
				t.Errorf("%s changed. If the change is intended and backward compatible, rerun with -update.\ngot:\n%s", tc.name, got)
			}
		})
	}
}
