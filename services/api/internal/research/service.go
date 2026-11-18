package research

import (
	"context"
	"errors"
	"slices"
	"sync"
	"time"

	"golang.org/x/sync/errgroup"

	"github.com/tonklasocute/mallowtick/services/api/internal/market"
)

// Disclaimer goes with every research response; the app shows it as is.
const Disclaimer = "ข้อสังเกตสร้างโดยกฎของ Mallowtick จากข้อมูลของผู้ให้บริการ เพื่อประกอบการศึกษาเท่านั้น ไม่ใช่คำแนะนำให้ซื้อหรือขาย และไม่ได้บอกสาเหตุของการเปลี่ยนแปลงราคา"

const (
	// MaxSymbols bounds one briefing or insights request (a portfolio or a watchlist).
	MaxSymbols = market.MaxBatchSymbols
	// Per request, at most this many symbols may miss the cache for their daily
	// bars (one Twelve Data credit each) or their earnings history (two Finnhub
	// calls each). The rest are listed in Coverage and come with a later request.
	candleFetches = 2
	detailFetches = 3
	// MinCompare and MaxCompare bound a comparison.
	MinCompare = 2
	MaxCompare = 4
	// ThingsToWatch is how many symbol insights the briefing highlights.
	ThingsToWatch = 6
	// newsSymbols is how many symbols' news one request may fetch (the API's limit).
	newsSymbols = market.NewsMaxSymbols
	// fetchWait bounds how long a request waits for the bars and results it fetches.
	fetchWait = 6 * time.Second
)

// Kinds of data an insight may lack, for Coverage.
const (
	DataQuote      = "quote"
	DataTechnicals = "technicals"
	DataEarnings   = "earnings"
	DataResults    = "results"
	DataNews       = "news"
	DataSectors    = "sectors"
	DataBenchmarks = "benchmarks"
)

// Market is what the research service needs from the market service.
type Market interface {
	Today() string
	Quotes(ctx context.Context, symbols []market.Symbol) (market.QuoteBatch, error)
	Overview(ctx context.Context) (market.Overview, error)
	Sectors(ctx context.Context) (market.SectorsResult, error)
	CachedDaily(symbol market.Symbol) (market.CandleSeries, market.Freshness, bool)
	Candles(ctx context.Context, symbol market.Symbol, rng market.Range) (market.CandlesResult, error)
	EarningsCalendar(ctx context.Context, from, to string, symbols []market.Symbol) (market.EarningsCalendarResult, error)
	CachedEarningsDetail(symbol market.Symbol) (market.EarningsDetailResult, bool)
	EarningsDetail(ctx context.Context, symbol market.Symbol) (market.EarningsDetailResult, error)
	News(ctx context.Context, q market.NewsQuery) (market.NewsResult, error)
	CachedCompanyNews(symbol market.Symbol) ([]market.NewsArticle, bool)
	Fundamentals(ctx context.Context, symbol market.Symbol) (market.FundamentalsResult, error)
	Recommendations(ctx context.Context, symbol market.Symbol) (market.RecommendationsResult, error)
}

// Service builds briefings, insights and comparisons.
type Service struct {
	m   Market
	now func() time.Time
	// fetchWait is how long a request waits for bars and results (tests shorten it).
	fetchWait time.Duration
}

// NewService returns a research service over m. now may be nil.
func NewService(m Market, now func() time.Time) *Service {
	if now == nil {
		now = time.Now
	}
	return &Service{m: m, now: now, fetchWait: fetchWait}
}

// Missing names data an insight could not use, and why (an API error code).
type Missing struct {
	Data   string `json:"data"`
	Reason string `json:"reason"`
}

// Coverage lists what was missing for one symbol (or "" for the market).
type Coverage struct {
	Symbol  string    `json:"symbol"`
	Missing []Missing `json:"missing"`
}

// InsightsResult is the symbol insights for a set of symbols.
type InsightsResult struct {
	Today       string     `json:"today"`
	GeneratedAt time.Time  `json:"generatedAt"`
	Insights    []Insight  `json:"insights"`
	Coverage    []Coverage `json:"coverage"`
	Disclaimer  string     `json:"disclaimer"`
}

// Briefing is the day's market overview plus the symbols' insights.
type Briefing struct {
	Today       string    `json:"today"`
	GeneratedAt time.Time `json:"generatedAt"`
	Market      []Insight `json:"market"`
	Insights    []Insight `json:"insights"`
	// ThingsToWatch are the highest-priority symbol insights.
	ThingsToWatch []Insight  `json:"thingsToWatch"`
	Coverage      []Coverage `json:"coverage"`
	Disclaimer    string     `json:"disclaimer"`
}

// BenchmarkLabels name the default benchmark ETFs after the indexes they track.
var BenchmarkLabels = map[string]string{"SPY": "SPY (S&P 500)", "QQQ": "QQQ (Nasdaq-100)", "DIA": "DIA (Dow Jones)"}

// Briefing returns the market insights and, for symbols, theirs.
func (s *Service) Briefing(ctx context.Context, symbols []market.Symbol) (Briefing, error) {
	b := Briefing{Today: s.m.Today(), GeneratedAt: s.now().UTC(), Market: []Insight{}, Insights: []Insight{},
		ThingsToWatch: []Insight{}, Coverage: []Coverage{}, Disclaimer: Disclaimer}
	var (
		md       MarketData
		mMissing []Missing
		sym      InsightsResult
	)
	g, gctx := errgroup.WithContext(ctx)
	g.Go(func() error {
		md.BenchmarkLabels = BenchmarkLabels
		if ov, err := s.m.Overview(gctx); err == nil {
			md.Benchmarks = ov.Benchmarks
		} else {
			mMissing = append(mMissing, Missing{DataBenchmarks, market.ErrorCode(err)})
		}
		if sec, err := s.m.Sectors(gctx); err == nil {
			md.Sectors = &sec
		} else {
			mMissing = append(mMissing, Missing{DataSectors, market.ErrorCode(err)})
		}
		return nil
	})
	if len(symbols) > 0 {
		g.Go(func() error {
			sym = s.insights(gctx, symbols)
			return nil
		})
	}
	_ = g.Wait()
	if err := ctx.Err(); err != nil {
		return Briefing{}, err
	}
	b.Market = Rank(MarketInsights(md))
	if len(mMissing) > 0 {
		b.Coverage = append(b.Coverage, Coverage{Symbol: "", Missing: mMissing})
	}
	if len(symbols) > 0 {
		b.Insights = sym.Insights
		b.Coverage = append(b.Coverage, sym.Coverage...)
		b.ThingsToWatch = b.Insights[:min(ThingsToWatch, len(b.Insights))]
	}
	if len(b.Market) == 0 && len(symbols) == 0 && len(mMissing) > 0 {
		// Nothing to show and nothing configured: say why, as the other endpoints do.
		if mMissing[0].Reason == "provider_not_configured" {
			return Briefing{}, market.ErrNotConfigured
		}
	}
	return b, nil
}

// Insights returns the symbol insights for symbols.
func (s *Service) Insights(ctx context.Context, symbols []market.Symbol) (InsightsResult, error) {
	res := s.insights(ctx, symbols)
	if err := ctx.Err(); err != nil {
		return InsightsResult{}, err
	}
	return res, nil
}

func (s *Service) insights(ctx context.Context, symbols []market.Symbol) InsightsResult {
	today := s.m.Today()
	data := make(map[market.Symbol]*SymbolData, len(symbols))
	missing := make(map[market.Symbol][]Missing)
	for _, sym := range symbols {
		data[sym] = &SymbolData{Symbol: string(sym)}
	}
	note := func(sym market.Symbol, what string, err error) {
		missing[sym] = append(missing[sym], Missing{what, market.ErrorCode(err)})
	}

	// Quotes, the calendar and news are independent; fetch them together.
	var (
		quotes   market.QuoteBatch
		quoteErr error
		cal      market.EarningsCalendarResult
		calErr   error
		newsRes  market.NewsResult
		newsErr  error
	)
	g, gctx := errgroup.WithContext(ctx)
	g.Go(func() error { quotes, quoteErr = s.m.Quotes(gctx, symbols); return nil })
	g.Go(func() error {
		cal, calErr = s.m.EarningsCalendar(gctx, today, market.AddDays(today, EarningsSoonDays), symbols)
		return nil
	})
	// News is fetched for symbols not cached yet, up to the news request's
	// limit (which fetches a few of them); every symbol's news is then read from
	// the cache. Later requests take the next ones, so all of them arrive.
	var newsToFetch []market.Symbol
	for _, sym := range symbols {
		if _, ok := s.m.CachedCompanyNews(sym); !ok && len(newsToFetch) < newsSymbols {
			newsToFetch = append(newsToFetch, sym)
		}
	}
	if len(newsToFetch) > 0 {
		g.Go(func() error {
			newsRes, newsErr = s.m.News(gctx, market.NewsQuery{Symbols: newsToFetch, Limit: 1})
			return nil
		})
	}
	_ = g.Wait()

	if quoteErr != nil {
		for _, sym := range symbols {
			note(sym, DataQuote, quoteErr)
		}
	} else {
		for i := range quotes.Quotes {
			q := quotes.Quotes[i]
			if d, ok := data[market.Symbol(q.Symbol)]; ok {
				d.Quote = &q
			}
		}
		for _, u := range quotes.Unavailable {
			missing[u.Symbol] = append(missing[u.Symbol], Missing{DataQuote, u.Reason})
		}
	}

	if calErr != nil {
		for _, sym := range symbols {
			note(sym, DataEarnings, calErr)
		}
	} else {
		for i := range cal.Events {
			ev := cal.Events[i]
			d := data[market.Symbol(ev.Symbol)]
			if d == nil || ev.EPSActual != nil || ev.RevenueActual != nil {
				continue
			}
			if d.NextEarnings == nil || ev.Date < d.NextEarnings.Date {
				d.NextEarnings, d.EarningsSource = &ev, cal.Freshness.Provider
			}
		}
	}

	waiting := map[market.Symbol]string{}
	if newsErr != nil {
		for _, sym := range newsToFetch {
			waiting[sym] = market.ErrorCode(newsErr)
		}
	} else {
		for _, u := range newsRes.Unavailable {
			waiting[u.Symbol] = u.Reason
		}
	}
	for _, sym := range symbols {
		if articles, ok := s.m.CachedCompanyNews(sym); ok {
			grouped := market.GroupNews(articles)
			data[sym].News, data[sym].NewsSource = grouped, sourceOf(grouped)
		} else if reason, ok := waiting[sym]; ok {
			missing[sym] = append(missing[sym], Missing{DataNews, reason})
		} else {
			// Not asked for in this request: it comes with a later one.
			missing[sym] = append(missing[sym], Missing{DataNews, "rate_limited"})
		}
	}

	// Daily bars and earnings results cost the most: only a few missing ones are
	// fetched per request, together and within fetchWait. A fetch still running
	// then goes on in the background (the market service detaches it) and is
	// cached for the next request.
	var toCandles, toDetail []market.Symbol
	for _, sym := range symbols {
		if _, _, ok := s.m.CachedDaily(sym); !ok {
			if len(toCandles) < candleFetches {
				toCandles = append(toCandles, sym)
			} else {
				missing[sym] = append(missing[sym], Missing{DataTechnicals, "rate_limited"})
			}
		}
		if _, ok := s.m.CachedEarningsDetail(sym); !ok {
			if len(toDetail) < detailFetches {
				toDetail = append(toDetail, sym)
			} else {
				missing[sym] = append(missing[sym], Missing{DataResults, "rate_limited"})
			}
		}
	}
	var mu sync.Mutex
	fctx, cancel := context.WithTimeout(ctx, s.fetchWait)
	fg, fgctx := errgroup.WithContext(fctx)
	for _, sym := range toCandles {
		fg.Go(func() error {
			if _, err := s.m.Candles(fgctx, sym, market.Range1Y); err != nil {
				mu.Lock()
				note(sym, DataTechnicals, err)
				mu.Unlock()
			}
			return nil
		})
	}
	for _, sym := range toDetail {
		fg.Go(func() error {
			if _, err := s.m.EarningsDetail(fgctx, sym); err != nil && !errors.Is(err, market.ErrNotConfigured) {
				mu.Lock()
				note(sym, DataResults, err)
				mu.Unlock()
			}
			return nil
		})
	}
	_ = fg.Wait()
	cancel()
	for _, sym := range symbols {
		d := data[sym]
		if series, fresh, ok := s.m.CachedDaily(sym); ok {
			d.Daily, d.DailySource, d.DailyAt = series.Candles, fresh.Provider, fresh.FetchedAt
		}
		if detail, ok := s.m.CachedEarningsDetail(sym); ok && len(detail.Quarters) > 0 {
			d.LastQuarter, d.ResultSource = &detail.Quarters[0], detail.Freshness.Provider
		}
	}

	res := InsightsResult{Today: today, GeneratedAt: s.now().UTC(), Insights: []Insight{}, Coverage: []Coverage{}, Disclaimer: Disclaimer}
	now := s.now()
	for _, sym := range symbols {
		res.Insights = append(res.Insights, SymbolInsights(*data[sym], today, now)...)
		if m := missing[sym]; len(m) > 0 {
			res.Coverage = append(res.Coverage, Coverage{Symbol: string(sym), Missing: m})
		}
	}
	res.Insights = Rank(res.Insights)
	return res
}

func sourceOf(articles []market.NewsArticle) string {
	if len(articles) > 0 {
		return articles[0].Provider
	}
	return ""
}

// CompareItem is one symbol's figures side by side with the others'.
type CompareItem struct {
	Symbol        string                      `json:"symbol"`
	Name          string                      `json:"name"`
	Logo          string                      `json:"logo"`
	Currency      string                      `json:"currency"`
	Price         *float64                    `json:"price"`
	ChangePercent *float64                    `json:"changePercent"`
	AsOf          *time.Time                  `json:"asOf"`
	Fundamentals  *market.Fundamentals        `json:"fundamentals"`
	EPSRecord     *market.EarningsRecord      `json:"epsRecord"`
	LastQuarter   *market.EarningsQuarter     `json:"lastQuarter"`
	Ratings       *market.RecommendationTrend `json:"ratings"`
	Sources       []string                    `json:"sources"`
	Missing       []Missing                   `json:"missing"`
}

// Comparison lists the symbols in the order asked.
type Comparison struct {
	GeneratedAt time.Time     `json:"generatedAt"`
	Items       []CompareItem `json:"items"`
	Disclaimer  string        `json:"disclaimer"`
}

// Compare gathers the same figures for each symbol, one symbol at a time so a
// comparison never sends a burst of vendor calls.
func (s *Service) Compare(ctx context.Context, symbols []market.Symbol) (Comparison, error) {
	out := Comparison{GeneratedAt: s.now().UTC(), Items: make([]CompareItem, 0, len(symbols)), Disclaimer: Disclaimer}
	batch, qErr := s.m.Quotes(ctx, symbols)
	if errors.Is(qErr, market.ErrNotConfigured) {
		return Comparison{}, qErr
	}
	quotes := map[string]market.QuoteResult{}
	for _, q := range batch.Quotes {
		quotes[q.Symbol] = q
	}
	reasons := map[market.Symbol]string{}
	for _, u := range batch.Unavailable {
		reasons[u.Symbol] = u.Reason
	}
	for _, sym := range symbols {
		it := CompareItem{Symbol: string(sym), Sources: []string{}, Missing: []Missing{}}
		add := func(src string) {
			if src != "" && !slices.Contains(it.Sources, src) {
				it.Sources = append(it.Sources, src)
			}
		}
		if q, ok := quotes[string(sym)]; ok {
			price := q.Price
			it.Name, it.Logo, it.Currency, it.Price, it.ChangePercent, it.AsOf = q.Name, q.Logo, q.Currency, &price, q.ChangePercent, q.AsOf
			add(q.Freshness.Provider)
		} else {
			reason := reasons[sym]
			if qErr != nil {
				reason = market.ErrorCode(qErr)
			}
			it.Missing = append(it.Missing, Missing{DataQuote, reason})
		}
		if f, err := s.m.Fundamentals(ctx, sym); err == nil {
			it.Fundamentals = &f.Fundamentals
			add(f.Freshness.Provider)
		} else {
			it.Missing = append(it.Missing, Missing{"fundamentals", market.ErrorCode(err)})
		}
		if d, err := s.m.EarningsDetail(ctx, sym); err == nil {
			rec := d.EPSRecord
			it.EPSRecord = &rec
			if len(d.Quarters) > 0 {
				it.LastQuarter = &d.Quarters[0]
			}
			add(d.Freshness.Provider)
		} else {
			it.Missing = append(it.Missing, Missing{DataResults, market.ErrorCode(err)})
		}
		if r, err := s.m.Recommendations(ctx, sym); err == nil {
			if len(r.Trends) > 0 {
				it.Ratings = &r.Trends[0]
			}
			add(r.Freshness.Provider)
		} else {
			it.Missing = append(it.Missing, Missing{"ratings", market.ErrorCode(err)})
		}
		if err := ctx.Err(); err != nil {
			return Comparison{}, err
		}
		out.Items = append(out.Items, it)
	}
	return out, nil
}
