package market

import (
	"context"
	"time"
)

// DataKind names a kind of market data, so a deployment can take each kind
// from the vendor whose plan covers it best.
type DataKind string

const (
	KindQuotes   DataKind = "quotes"
	KindSearch   DataKind = "search"
	KindCandles  DataKind = "candles"
	KindStatus   DataKind = "status"
	KindEarnings DataKind = "earnings"
)

// DataKinds lists every kind in display order.
var DataKinds = []DataKind{KindQuotes, KindSearch, KindCandles, KindStatus, KindEarnings}

// MultiSource is implemented by providers that combine vendors. SourceFor
// returns the vendor behind a kind of data, so freshness metadata names the
// vendor that actually supplied it.
type MultiSource interface {
	SourceFor(kind DataKind) Provider
}

// EarningsEvent is a scheduled earnings report.
type EarningsEvent struct {
	Symbol string `json:"symbol"`
	// Date is the report date (YYYY-MM-DD) in US market time.
	Date string `json:"date"`
	// Hour is "bmo" (before market open), "amc" (after market close), "dmh"
	// (during market hours), or empty when not announced.
	Hour            string   `json:"hour"`
	Quarter         int      `json:"quarter,omitempty"`
	Year            int      `json:"year,omitempty"`
	EPSEstimate     *float64 `json:"epsEstimate"`
	RevenueEstimate *float64 `json:"revenueEstimate"`
}

// RangeProvider is implemented by vendors whose quotes lack the 52-week range
// but can look it up separately (one extra call, worth it on Stock Detail only).
type RangeProvider interface {
	FiftyTwoWeek(ctx context.Context, symbol Symbol) (*Range52, error)
}

// EarningsProvider is implemented by vendors that publish an earnings calendar.
type EarningsProvider interface {
	// NextEarnings returns the next report on or after from, or nil when none
	// is scheduled within the provider's calendar.
	NextEarnings(ctx context.Context, symbol Symbol, from time.Time) (*EarningsEvent, error)
}

// Composite takes quotes, search and earnings from one vendor and candles and
// market status from another. It is used when a second vendor's free plan
// has a far larger request allowance but no historical bars.
type Composite struct {
	// QuoteSource serves quotes, search and (when it implements
	// EarningsProvider) earnings.
	QuoteSource Provider
	// BarSource serves candles and market status.
	BarSource Provider
}

var (
	_ Provider         = Composite{}
	_ MultiSource      = Composite{}
	_ EarningsProvider = Composite{}
)

func (c Composite) Name() string     { return c.QuoteSource.Name() + "+" + c.BarSource.Name() }
func (c Composite) Configured() bool { return c.QuoteSource.Configured() && c.BarSource.Configured() }

// SourceFor implements MultiSource.
func (c Composite) SourceFor(kind DataKind) Provider {
	switch kind {
	case KindCandles, KindStatus:
		return c.BarSource
	default:
		return c.QuoteSource
	}
}

func (c Composite) SearchSymbols(ctx context.Context, query string, limit int) ([]Instrument, error) {
	return c.QuoteSource.SearchSymbols(ctx, query, limit)
}

func (c Composite) Quotes(ctx context.Context, symbols []Symbol) (map[Symbol]Quote, error) {
	return c.QuoteSource.Quotes(ctx, symbols)
}

func (c Composite) Candles(ctx context.Context, symbol Symbol, interval Interval, bars int) (CandleSeries, error) {
	return c.BarSource.Candles(ctx, symbol, interval, bars)
}

func (c Composite) MarketStatus(ctx context.Context) (MarketStatus, error) {
	return c.BarSource.MarketStatus(ctx)
}

// NextEarnings implements EarningsProvider through the quotes vendor.
func (c Composite) NextEarnings(ctx context.Context, symbol Symbol, from time.Time) (*EarningsEvent, error) {
	if e, ok := c.QuoteSource.(EarningsProvider); ok && c.QuoteSource.Configured() {
		return e.NextEarnings(ctx, symbol, from)
	}
	return nil, ErrNotConfigured
}
