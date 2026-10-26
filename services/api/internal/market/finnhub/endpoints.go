package finnhub

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
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

// instrumentInfo is the descriptive data a quote needs and /quote lacks.
type instrumentInfo struct {
	Name     string
	Exchange string
	Currency string
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

// instrument returns cached name, exchange and currency for symbol. ETFs have
// no company profile, so their name comes from an exact search match.
func (c *Client) instrument(ctx context.Context, sym market.Symbol) (instrumentInfo, error) {
	if e, state := c.info.Get(string(sym)); state == cache.Fresh {
		return e.Value, nil
	}
	var p struct {
		Name     string `json:"name"`
		Exchange string `json:"exchange"`
		Currency string `json:"currency"`
	}
	if err := c.get(ctx, "/stock/profile2", url.Values{"symbol": {string(sym)}}, &p); err != nil {
		return instrumentInfo{}, err
	}
	info := instrumentInfo{Name: p.Name, Exchange: shortExchange(p.Exchange), Currency: p.Currency}
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
		q.Name, q.Exchange, q.Currency = info.Name, info.Exchange, info.Currency
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
	return all[:min(limit, len(all))], nil
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
