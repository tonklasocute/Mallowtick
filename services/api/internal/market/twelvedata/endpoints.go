package twelvedata

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/tonklasocute/mallowtick/services/api/internal/market"
)

// usCountry is how Twelve Data names the United States in instrument metadata.
const usCountry = "United States"

// nyseMIC is the market whose state represents regular US equity hours.
const nyseMIC = "XNYS"

// num decodes Twelve Data's numbers, which arrive as JSON strings or numbers.
// Empty or unparseable values decode as "not reported".
type num struct {
	v  float64
	ok bool
}

func (n *num) UnmarshalJSON(b []byte) error {
	s := strings.Trim(string(b), `"`)
	if s == "" || s == "null" {
		return nil
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return nil
	}
	n.v, n.ok = f, true
	return nil
}

func (n num) ptr() *float64 {
	if !n.ok {
		return nil
	}
	v := n.v
	return &v
}

func (n num) int64Ptr() *int64 {
	if !n.ok {
		return nil
	}
	v := int64(n.v)
	return &v
}

// SearchSymbols implements market.Provider.
func (c *Client) SearchSymbols(ctx context.Context, query string, limit int) ([]market.Instrument, error) {
	body, err := c.get(ctx, "/symbol_search", url.Values{"symbol": {query}, "outputsize": {"30"}}, 1)
	if err != nil {
		return nil, err
	}
	var resp struct {
		Data []struct {
			Symbol         string `json:"symbol"`
			InstrumentName string `json:"instrument_name"`
			Exchange       string `json:"exchange"`
			MICCode        string `json:"mic_code"`
			InstrumentType string `json:"instrument_type"`
			Country        string `json:"country"`
			Currency       string `json:"currency"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("%w: decode symbol_search: %w", market.ErrUnavailable, err)
	}
	out := make([]market.Instrument, 0, limit)
	seen := make(map[string]bool)
	for _, d := range resp.Data {
		if d.Country != usCountry || seen[d.Symbol] {
			continue
		}
		if _, err := market.ParseSymbol(d.Symbol); err != nil {
			continue
		}
		seen[d.Symbol] = true
		out = append(out, market.Instrument{
			Symbol: d.Symbol, Name: d.InstrumentName, Exchange: d.Exchange, MICCode: d.MICCode,
			Currency: d.Currency, Type: d.InstrumentType, Country: d.Country,
		})
		if len(out) == limit {
			break
		}
	}
	return out, nil
}

type quoteDTO struct {
	apiError
	Symbol        string `json:"symbol"`
	Name          string `json:"name"`
	Exchange      string `json:"exchange"`
	Currency      string `json:"currency"`
	LastQuoteAt   num    `json:"last_quote_at"`
	Open          num    `json:"open"`
	High          num    `json:"high"`
	Low           num    `json:"low"`
	Close         num    `json:"close"`
	Volume        num    `json:"volume"`
	PreviousClose num    `json:"previous_close"`
	Change        num    `json:"change"`
	PercentChange num    `json:"percent_change"`
	IsMarketOpen  *bool  `json:"is_market_open"`
	FiftyTwoWeek  *struct {
		Low  num `json:"low"`
		High num `json:"high"`
	} `json:"fifty_two_week"`
}

func (d quoteDTO) toQuote() (market.Quote, bool) {
	if !d.Close.ok || d.Symbol == "" {
		return market.Quote{}, false
	}
	q := market.Quote{
		Symbol: d.Symbol, Name: d.Name, Exchange: d.Exchange, Currency: d.Currency,
		Price: d.Close.v, Open: d.Open.ptr(), High: d.High.ptr(), Low: d.Low.ptr(),
		PreviousClose: d.PreviousClose.ptr(), Change: d.Change.ptr(), ChangePercent: d.PercentChange.ptr(),
		Volume: d.Volume.int64Ptr(), IsMarketOpen: d.IsMarketOpen,
	}
	if d.FiftyTwoWeek != nil && d.FiftyTwoWeek.Low.ok && d.FiftyTwoWeek.High.ok {
		q.FiftyTwoWeek = &market.Range52{Low: d.FiftyTwoWeek.Low.v, High: d.FiftyTwoWeek.High.v}
	}
	// last_quote_at is the time of the latest trade data. The "timestamp"
	// field is the daily bar's start, so it is deliberately not used here.
	if d.LastQuoteAt.ok && d.LastQuoteAt.v > 0 {
		t := time.Unix(int64(d.LastQuoteAt.v), 0).UTC()
		q.AsOf = &t
	}
	return q, true
}

// Quotes implements market.Provider. Each symbol costs one credit, so a batch
// is fetched in the order given, only as far as credits allow: the first
// chunk may wait for credits (up to MaxWait), later ones only use credits
// that are free now. Symbols left over are reported with ErrRateLimited
// alongside the partial result, so a screen shows what it can and fills in
// the rest on its next refresh.
func (c *Client) Quotes(ctx context.Context, symbols []market.Symbol) (map[market.Symbol]market.Quote, error) {
	out := make(map[market.Symbol]market.Quote, len(symbols))
	for start := 0; start < len(symbols); {
		size := min(c.burst, len(symbols)-start)
		if avail := c.budget.available(); avail < size {
			if start > 0 && avail == 0 {
				return out, fmt.Errorf("%w: no credits left for %d more symbols", market.ErrRateLimited, len(symbols)-start)
			}
			size = max(avail, 1)
		}
		if err := c.quoteChunk(ctx, symbols[start:start+size], out); err != nil {
			return out, err
		}
		start += size
	}
	return out, nil
}

func (c *Client) quoteChunk(ctx context.Context, symbols []market.Symbol, out map[market.Symbol]market.Quote) error {
	names := make([]string, len(symbols))
	for i, s := range symbols {
		names[i] = string(s)
	}
	body, err := c.get(ctx, "/quote", url.Values{"symbol": {strings.Join(names, ",")}}, len(symbols))
	if err != nil {
		return err
	}

	// A single symbol returns one object; several return an object keyed by symbol.
	dtos := make(map[string]quoteDTO, len(symbols))
	if len(symbols) == 1 {
		var d quoteDTO
		if err := json.Unmarshal(body, &d); err != nil {
			return fmt.Errorf("%w: decode quote: %w", market.ErrUnavailable, err)
		}
		dtos[names[0]] = d
	} else if err := json.Unmarshal(body, &dtos); err != nil {
		return fmt.Errorf("%w: decode batch quote: %w", market.ErrUnavailable, err)
	}

	for _, s := range symbols {
		d, ok := dtos[string(s)]
		if !ok || d.isError() {
			continue
		}
		if q, ok := d.toQuote(); ok {
			out[s] = q
		}
	}
	if len(symbols) == 1 && len(out) == 0 {
		return fmt.Errorf("%w: no quote for %s", market.ErrNotFound, symbols[0])
	}
	return nil
}

// Candles implements market.Provider.
func (c *Client) Candles(ctx context.Context, symbol market.Symbol, interval market.Interval, bars int) (market.CandleSeries, error) {
	params := url.Values{
		"symbol":     {string(symbol)},
		"interval":   {string(interval)},
		"outputsize": {strconv.Itoa(bars)},
		"order":      {"asc"},
	}
	body, err := c.get(ctx, "/time_series", params, 1)
	if err != nil {
		return market.CandleSeries{}, err
	}
	var resp struct {
		Meta struct {
			Symbol           string `json:"symbol"`
			Currency         string `json:"currency"`
			ExchangeTimezone string `json:"exchange_timezone"`
		} `json:"meta"`
		Values []struct {
			Datetime string `json:"datetime"`
			Open     num    `json:"open"`
			High     num    `json:"high"`
			Low      num    `json:"low"`
			Close    num    `json:"close"`
			Volume   num    `json:"volume"`
		} `json:"values"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return market.CandleSeries{}, fmt.Errorf("%w: decode time_series: %w", market.ErrUnavailable, err)
	}
	loc, err := time.LoadLocation(resp.Meta.ExchangeTimezone)
	if err != nil || resp.Meta.ExchangeTimezone == "" {
		return market.CandleSeries{}, fmt.Errorf("%w: unknown exchange timezone %q", market.ErrUnavailable, resp.Meta.ExchangeTimezone)
	}

	series := market.CandleSeries{
		Symbol: string(symbol), Interval: interval, Currency: resp.Meta.Currency,
		ExchangeTimezone: resp.Meta.ExchangeTimezone, Candles: make([]market.Candle, 0, len(resp.Values)),
	}
	for _, v := range resp.Values {
		t, err := parseDatetime(v.Datetime, loc)
		if err != nil || !v.Open.ok || !v.High.ok || !v.Low.ok || !v.Close.ok {
			continue // skip malformed bars rather than inventing values
		}
		series.Candles = append(series.Candles, market.Candle{
			Time: t, Open: v.Open.v, High: v.High.v, Low: v.Low.v, Close: v.Close.v, Volume: v.Volume.int64Ptr(),
		})
	}
	return series, nil
}

func parseDatetime(s string, loc *time.Location) (time.Time, error) {
	for _, layout := range []string{time.DateTime, time.DateOnly} {
		if t, err := time.ParseInLocation(layout, s, loc); err == nil {
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf("unrecognized datetime %q", s)
}

// MarketStatus implements market.Provider using the NYSE market state.
func (c *Client) MarketStatus(ctx context.Context) (market.MarketStatus, error) {
	body, err := c.get(ctx, "/market_state", url.Values{"code": {nyseMIC}}, 1)
	if err != nil {
		return market.MarketStatus{}, err
	}
	var states []struct {
		Name         string `json:"name"`
		Code         string `json:"code"`
		IsMarketOpen bool   `json:"is_market_open"`
		TimeToOpen   string `json:"time_to_open"`
		TimeToClose  string `json:"time_to_close"`
	}
	if err := json.Unmarshal(body, &states); err != nil {
		return market.MarketStatus{}, fmt.Errorf("%w: decode market_state: %w", market.ErrUnavailable, err)
	}
	if len(states) == 0 {
		return market.MarketStatus{}, fmt.Errorf("%w: market_state returned no markets", market.ErrUnavailable)
	}
	s := states[0]
	st := market.MarketStatus{Exchange: s.Code, Name: s.Name, IsOpen: s.IsMarketOpen}
	if s.IsMarketOpen {
		st.ClosesInSeconds = parseCountdown(s.TimeToClose)
	} else {
		st.OpensInSeconds = parseCountdown(s.TimeToOpen)
	}
	return st, nil
}

// parseCountdown converts "HH:MM:SS" (hours may exceed 24) to seconds.
// Zero or malformed values are treated as not reported.
func parseCountdown(s string) *int64 {
	parts := strings.Split(s, ":")
	if len(parts) != 3 {
		return nil
	}
	var total int64
	for i, p := range parts {
		n, err := strconv.ParseInt(p, 10, 64)
		if err != nil || n < 0 {
			return nil
		}
		total += n * []int64{3600, 60, 1}[i]
	}
	if total == 0 {
		return nil
	}
	return &total
}
