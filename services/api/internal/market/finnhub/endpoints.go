package finnhub

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"net/url"
	"slices"
	"strings"
	"sync"
	"time"

	"golang.org/x/sync/errgroup"

	"github.com/tonklasocute/mallowtick/services/api/internal/cache"
	"github.com/tonklasocute/mallowtick/services/api/internal/market"
)

// earningsHorizon is how far ahead the earnings calendar is searched.
const earningsHorizon = 90 * 24 * time.Hour

// parallelCalls bounds concurrent requests for one batch.
const parallelCalls = 4

// instrumentInfo is the descriptive data a quote needs and /quote lacks, plus
// the rest of the company profile for Fundamentals.
type instrumentInfo struct {
	Name     string
	Exchange string
	Currency string

	Industry string
	Country  string
	IPODate  string
	Website  string
	Logo     string
	// Shares is the share count in units, nil when unknown.
	Shares *float64
}

// millions is the multiplier for Finnhub's market cap, enterprise value and
// share count, which are reported in millions.
const millions = 1e6

func scaled(v *float64, by float64) *float64 {
	if v == nil {
		return nil
	}
	x := *v * by
	return &x
}

// shortExchange turns Finnhub's long exchange names into the usual tickers.
func shortExchange(name string) string {
	n := strings.ToUpper(name)
	switch {
	case strings.Contains(n, "NASDAQ"):
		return "NASDAQ"
	case strings.Contains(n, "ARCA"):
		return "NYSE Arca"
	case strings.Contains(n, "AMERICAN") || strings.Contains(n, "NYSE MKT"):
		return "NYSE American"
	case strings.Contains(n, "NEW YORK STOCK EXCHANGE") || n == "NYSE":
		return "NYSE"
	case strings.Contains(n, "CBOE") || strings.Contains(n, "BATS"):
		return "Cboe"
	}
	return name
}

// cleanName drops the "-US" suffix Finnhub search appends to some names.
func cleanName(s string) string {
	return strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(s), "-US"))
}

// logoWait bounds how long a search waits for logos. They are decoration: past
// this, or when the call budget is spent, results go out without them.
const logoWait = 2 * time.Second

// cleanLogo keeps only an https URL; anything else is treated as no logo, so the
// API never hands the browser a URL it should not load.
func cleanLogo(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Scheme != "https" || u.Host == "" {
		return ""
	}
	return u.String()
}

// logoFor returns the logo URL for symbol from the caches, or from one
// /stock/profile2 call. Failures give "" and are not cached.
func (c *Client) logoFor(ctx context.Context, sym market.Symbol) string {
	if e, state := c.logos.Get(string(sym)); state == cache.Fresh {
		return e.Value
	}
	if e, state := c.info.Get(string(sym)); state == cache.Fresh {
		return e.Value.Logo
	}
	var p struct {
		Logo string `json:"logo"`
	}
	if err := c.get(ctx, "/stock/profile2", url.Values{"symbol": {string(sym)}}, &p); err != nil {
		return ""
	}
	logo := cleanLogo(p.Logo)
	c.logos.Set(string(sym), logo)
	return logo
}

// attachLogos fills in found[i].Logo, a few calls at a time, within logoWait.
func (c *Client) attachLogos(ctx context.Context, found []market.Instrument) {
	lctx, cancel := context.WithTimeout(ctx, logoWait)
	defer cancel()
	var g errgroup.Group
	g.SetLimit(parallelCalls)
	for i := range found {
		g.Go(func() error {
			found[i].Logo = c.logoFor(lctx, market.Symbol(found[i].Symbol))
			return nil
		})
	}
	_ = g.Wait()
}

// instrument returns cached name, exchange and currency for symbol. ETFs have
// no company profile, so their name comes from an exact search match.
func (c *Client) instrument(ctx context.Context, sym market.Symbol) (instrumentInfo, error) {
	if e, state := c.info.Get(string(sym)); state == cache.Fresh {
		return e.Value, nil
	}
	var p struct {
		Name     string   `json:"name"`
		Exchange string   `json:"exchange"`
		Currency string   `json:"currency"`
		Industry string   `json:"finnhubIndustry"`
		Country  string   `json:"country"`
		IPO      string   `json:"ipo"`
		Website  string   `json:"weburl"`
		Logo     string   `json:"logo"`
		Shares   *float64 `json:"shareOutstanding"`
	}
	if err := c.get(ctx, "/stock/profile2", url.Values{"symbol": {string(sym)}}, &p); err != nil {
		return instrumentInfo{}, err
	}
	info := instrumentInfo{
		Name: p.Name, Exchange: shortExchange(p.Exchange), Currency: p.Currency,
		Industry: p.Industry, Country: p.Country, IPODate: p.IPO, Website: p.Website,
		Logo: cleanLogo(p.Logo), Shares: scaled(p.Shares, millions),
	}
	if info.Name == "" {
		matches, err := c.search(ctx, string(sym))
		if err != nil {
			return instrumentInfo{}, err
		}
		for _, m := range matches {
			if strings.EqualFold(m.Symbol, string(sym)) {
				info.Name = m.Name
				break
			}
		}
	}
	if info.Currency == "" {
		info.Currency = "USD" // only US-listed instruments are supported
	}
	c.info.Set(string(sym), info)
	c.logos.Set(string(sym), info.Logo)
	return info, nil
}

// FiftyTwoWeek implements market.RangeProvider: the cached 52-week range for
// symbol, or nil when the provider has none.
func (c *Client) FiftyTwoWeek(ctx context.Context, sym market.Symbol) (*market.Range52, error) {
	if e, state := c.ranges.Get(string(sym)); state == cache.Fresh {
		r := e.Value
		return &r, nil
	}
	var m struct {
		Metric struct {
			High *float64 `json:"52WeekHigh"`
			Low  *float64 `json:"52WeekLow"`
		} `json:"metric"`
	}
	if err := c.get(ctx, "/stock/metric", url.Values{"symbol": {string(sym)}, "metric": {"all"}}, &m); err != nil {
		return nil, err
	}
	if m.Metric.High == nil || m.Metric.Low == nil {
		return nil, nil
	}
	r := market.Range52{Low: *m.Metric.Low, High: *m.Metric.High}
	c.ranges.Set(string(sym), r)
	return &r, nil
}

// Fundamentals implements market.FundamentalsProvider: the cached company
// profile plus one /stock/metric call, which also refreshes the 52-week range.
// ETFs have no profile and only price-based metrics.
func (c *Client) Fundamentals(ctx context.Context, sym market.Symbol) (market.Fundamentals, error) {
	info, err := c.instrument(ctx, sym)
	if err != nil {
		return market.Fundamentals{}, err
	}
	var m struct {
		Metric struct {
			High             *float64 `json:"52WeekHigh"`
			Low              *float64 `json:"52WeekLow"`
			MarketCap        *float64 `json:"marketCapitalization"`
			EnterpriseValue  *float64 `json:"enterpriseValue"`
			PE               *float64 `json:"peTTM"`
			PS               *float64 `json:"psTTM"`
			PB               *float64 `json:"pbQuarterly"`
			EPS              *float64 `json:"epsTTM"`
			RevenueGrowthYoY *float64 `json:"revenueGrowthTTMYoy"`
			RevenueGrowth5Y  *float64 `json:"revenueGrowth5Y"`
			EPSGrowthYoY     *float64 `json:"epsGrowthTTMYoy"`
			GrossMargin      *float64 `json:"grossMarginTTM"`
			OperatingMargin  *float64 `json:"operatingMarginTTM"`
			NetMargin        *float64 `json:"netProfitMarginTTM"`
			ROE              *float64 `json:"roeTTM"`
			CurrentRatio     *float64 `json:"currentRatioQuarterly"`
			DebtToEquity     *float64 `json:"totalDebt/totalEquityQuarterly"`
			DividendYield    *float64 `json:"dividendYieldIndicatedAnnual"`
			PayoutRatio      *float64 `json:"payoutRatioTTM"`
			Beta             *float64 `json:"beta"`
			ReturnYTD        *float64 `json:"yearToDatePriceReturnDaily"`
			Return1Y         *float64 `json:"52WeekPriceReturnDaily"`
			RelativeYTD      *float64 `json:"priceRelativeToS&P500Ytd"`
			Relative1Y       *float64 `json:"priceRelativeToS&P50052Week"`
			HighDate         string   `json:"52WeekHighDate"`
			LowDate          string   `json:"52WeekLowDate"`
		} `json:"metric"`
	}
	if err := c.get(ctx, "/stock/metric", url.Values{"symbol": {string(sym)}, "metric": {"all"}}, &m); err != nil {
		return market.Fundamentals{}, err
	}
	v := m.Metric
	if v.High != nil && v.Low != nil {
		c.ranges.Set(string(sym), market.Range52{Low: *v.Low, High: *v.High})
	}
	return market.Fundamentals{
		Symbol: string(sym), Industry: info.Industry, Country: info.Country, IPODate: info.IPODate,
		Website: info.Website, SharesOutstanding: info.Shares,
		Metrics: market.KeyMetrics{
			MarketCap: scaled(v.MarketCap, millions), EnterpriseValue: scaled(v.EnterpriseValue, millions),
			PE: v.PE, PS: v.PS, PB: v.PB, EPS: v.EPS,
			RevenueGrowthYoY: v.RevenueGrowthYoY, RevenueGrowth5Y: v.RevenueGrowth5Y, EPSGrowthYoY: v.EPSGrowthYoY,
			GrossMargin: v.GrossMargin, OperatingMargin: v.OperatingMargin, NetMargin: v.NetMargin, ROE: v.ROE,
			CurrentRatio: v.CurrentRatio, DebtToEquity: v.DebtToEquity,
			DividendYield: v.DividendYield, PayoutRatio: v.PayoutRatio, Beta: v.Beta,
			PriceReturnYTD: v.ReturnYTD, PriceReturn1Y: v.Return1Y,
			SP500ReturnYTD: benchmarkReturn(v.ReturnYTD, v.RelativeYTD), SP500Return1Y: benchmarkReturn(v.Return1Y, v.Relative1Y),
			FiftyTwoWeekHigh: v.High, FiftyTwoWeekLow: v.Low, FiftyTwoWeekHighDate: v.HighDate, FiftyTwoWeekLowDate: v.LowDate,
		},
	}, nil
}

// benchmarkReturn is the S&P 500's return over the same period. Finnhub's
// "price relative to S&P 500" is the difference in percentage points (checked
// 2026-10-27: AAPL 33.96% - SPY 13.13% = 20.83), so the index's return is
// the stock's minus that difference.
func benchmarkReturn(stock, relative *float64) *float64 {
	if stock == nil || relative == nil {
		return nil
	}
	r := math.Round((*stock-*relative)*1e4) / 1e4 // Finnhub's 4 decimals, without float noise
	return &r
}

// EarningsHistory implements market.EarningsProvider. The free plan returns
// the last four quarters.
func (c *Client) EarningsHistory(ctx context.Context, sym market.Symbol) ([]market.EarningsSurprise, error) {
	var rows []struct {
		Period          string   `json:"period"`
		Year            int      `json:"year"`
		Quarter         int      `json:"quarter"`
		Actual          *float64 `json:"actual"`
		Estimate        *float64 `json:"estimate"`
		Surprise        *float64 `json:"surprise"`
		SurprisePercent *float64 `json:"surprisePercent"`
	}
	if err := c.get(ctx, "/stock/earnings", url.Values{"symbol": {string(sym)}}, &rows); err != nil {
		return nil, err
	}
	out := make([]market.EarningsSurprise, 0, len(rows))
	for _, r := range rows {
		out = append(out, market.EarningsSurprise{
			Period: r.Period, Year: r.Year, Quarter: r.Quarter, Actual: r.Actual, Estimate: r.Estimate,
			Surprise: r.Surprise, SurprisePercent: r.SurprisePercent,
		})
	}
	slices.SortFunc(out, func(a, b market.EarningsSurprise) int { return strings.Compare(b.Period, a.Period) })
	return out, nil
}

// Recommendations implements market.FundamentalsProvider. ETFs have none.
func (c *Client) Recommendations(ctx context.Context, sym market.Symbol) ([]market.RecommendationTrend, error) {
	var rows []market.RecommendationTrend
	if err := c.get(ctx, "/stock/recommendation", url.Values{"symbol": {string(sym)}}, &rows); err != nil {
		return nil, err
	}
	slices.SortFunc(rows, func(a, b market.RecommendationTrend) int { return strings.Compare(b.Period, a.Period) })
	return rows, nil
}

func (c *Client) quote(ctx context.Context, sym market.Symbol) (market.Quote, error) {
	var d struct {
		Current       float64  `json:"c"`
		Change        *float64 `json:"d"`
		ChangePercent *float64 `json:"dp"`
		High          float64  `json:"h"`
		Low           float64  `json:"l"`
		Open          float64  `json:"o"`
		PreviousClose float64  `json:"pc"`
		Time          int64    `json:"t"`
	}
	if err := c.get(ctx, "/quote", url.Values{"symbol": {string(sym)}}, &d); err != nil {
		return market.Quote{}, err
	}
	if d.Current == 0 && d.Time == 0 {
		return market.Quote{}, fmt.Errorf("%w: no quote for %s", market.ErrNotFound, sym)
	}
	positive := func(v float64) *float64 {
		if v <= 0 {
			return nil
		}
		return &v
	}
	q := market.Quote{
		Symbol: string(sym), Price: d.Current, Open: positive(d.Open), High: positive(d.High),
		Low: positive(d.Low), PreviousClose: positive(d.PreviousClose),
		Change: d.Change, ChangePercent: d.ChangePercent,
	}
	if d.Time > 0 {
		t := time.Unix(d.Time, 0).UTC()
		q.AsOf = &t
	}

	// Names and ranges are extras: a quote is still useful without them, and a
	// later refresh fills them in once there is room in the budget.
	if info, err := c.instrument(ctx, sym); err == nil {
		q.Name, q.Exchange, q.Currency, q.Logo = info.Name, info.Exchange, info.Currency, info.Logo
	} else {
		q.Currency = "USD"
		c.log.DebugContext(ctx, "finnhub profile unavailable", slog.String("symbol", string(sym)), slog.Any("error", err))
	}
	return q, nil
}

// Quotes implements market.Provider with one /quote call per symbol (plus a
// profile call the first time a symbol is seen). The 52-week range is looked
// up separately through FiftyTwoWeek. Symbols that could not be fetched
// because of the rate limit or an outage are reported through the returned
// error alongside the partial result.
func (c *Client) Quotes(ctx context.Context, symbols []market.Symbol) (map[market.Symbol]market.Quote, error) {
	var (
		mu       sync.Mutex
		out      = make(map[market.Symbol]market.Quote, len(symbols))
		firstErr error
		g        errgroup.Group
	)
	g.SetLimit(parallelCalls)
	for _, sym := range symbols {
		g.Go(func() error {
			q, err := c.quote(ctx, sym)
			mu.Lock()
			defer mu.Unlock()
			switch {
			case err == nil:
				out[sym] = q
			case errors.Is(err, market.ErrNotFound):
				// absent from the map: unknown symbol
			case firstErr == nil:
				firstErr = err
			}
			return nil
		})
	}
	_ = g.Wait()
	if len(out) == 0 && firstErr != nil {
		return nil, firstErr
	}
	return out, firstErr
}

func (c *Client) search(ctx context.Context, query string) ([]market.Instrument, error) {
	var resp struct {
		Result []struct {
			Description string `json:"description"`
			Symbol      string `json:"symbol"`
			Type        string `json:"type"`
		} `json:"result"`
	}
	if err := c.get(ctx, "/search", url.Values{"q": {query}, "exchange": {"US"}}, &resp); err != nil {
		return nil, err
	}
	out := make([]market.Instrument, 0, len(resp.Result))
	seen := make(map[string]bool)
	for _, r := range resp.Result {
		if seen[r.Symbol] {
			continue
		}
		if _, err := market.ParseSymbol(r.Symbol); err != nil {
			continue // e.g. symbols with exchange suffixes
		}
		seen[r.Symbol] = true
		out = append(out, market.Instrument{
			Symbol: r.Symbol, Name: cleanName(r.Description), Type: r.Type,
			Currency: "USD", Country: "United States",
		})
	}
	return out, nil
}

// SearchSymbols implements market.Provider. Finnhub search results carry no
// exchange, so Instrument.Exchange is empty.
func (c *Client) SearchSymbols(ctx context.Context, query string, limit int) ([]market.Instrument, error) {
	all, err := c.search(ctx, query)
	if err != nil {
		return nil, err
	}
	found := all[:min(limit, len(all))]
	c.attachLogos(ctx, found)
	return found, nil
}

// Candles implements market.Provider. Historical candles are not on the free
// plan, so a composite provider takes them from another vendor.
func (c *Client) Candles(context.Context, market.Symbol, market.Interval, int) (market.CandleSeries, error) {
	return market.CandleSeries{}, fmt.Errorf("%w: finnhub candles need a paid plan", market.ErrNotEntitled)
}

// MarketStatus implements market.Provider. Finnhub reports no countdown to
// the next open or close.
func (c *Client) MarketStatus(ctx context.Context) (market.MarketStatus, error) {
	var s struct {
		Exchange string `json:"exchange"`
		IsOpen   bool   `json:"isOpen"`
	}
	if err := c.get(ctx, "/stock/market-status", url.Values{"exchange": {"US"}}, &s); err != nil {
		return market.MarketStatus{}, err
	}
	return market.MarketStatus{Exchange: s.Exchange, Name: "US market", IsOpen: s.IsOpen}, nil
}

// NextEarnings implements market.EarningsProvider. The free plan's calendar
// covers upcoming reports only, not past ones.
func (c *Client) NextEarnings(ctx context.Context, sym market.Symbol, from time.Time) (*market.EarningsEvent, error) {
	ny, err := time.LoadLocation("America/New_York")
	if err != nil {
		ny = time.UTC
	}
	start := from.In(ny).Format(time.DateOnly)
	end := from.Add(earningsHorizon).In(ny).Format(time.DateOnly)
	var resp struct {
		Calendar []struct {
			Date            string   `json:"date"`
			Hour            string   `json:"hour"`
			Quarter         int      `json:"quarter"`
			Year            int      `json:"year"`
			EPSEstimate     *float64 `json:"epsEstimate"`
			RevenueEstimate *float64 `json:"revenueEstimate"`
		} `json:"earningsCalendar"`
	}
	params := url.Values{"symbol": {string(sym)}, "from": {start}, "to": {end}}
	if err := c.get(ctx, "/calendar/earnings", params, &resp); err != nil {
		return nil, err
	}
	var next *market.EarningsEvent
	for _, e := range resp.Calendar {
		if e.Date < start || (next != nil && e.Date >= next.Date) {
			continue
		}
		next = &market.EarningsEvent{
			Symbol: string(sym), Date: e.Date, Hour: strings.ToLower(e.Hour), Quarter: e.Quarter,
			Year: e.Year, EPSEstimate: e.EPSEstimate, RevenueEstimate: e.RevenueEstimate,
		}
	}
	return next, nil
}
