package market

import (
	"context"
	"time"
)

// DataKind names a kind of market data, so a deployment can take each kind
// from the vendor whose plan covers it best.
type DataKind string

const (
	KindQuotes       DataKind = "quotes"
	KindSearch       DataKind = "search"
	KindCandles      DataKind = "candles"
	KindStatus       DataKind = "status"
	KindEarnings     DataKind = "earnings"
	KindFundamentals DataKind = "fundamentals"
)

// DataKinds lists every kind in display order.
var DataKinds = []DataKind{KindQuotes, KindSearch, KindCandles, KindStatus, KindEarnings, KindFundamentals}

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

// Fundamentals describes a listed company and how the market values it. Every
// figure is optional: ETFs and loss-making companies leave many of them nil.
type Fundamentals struct {
	Symbol   string `json:"symbol"`
	Industry string `json:"industry"`
	Country  string `json:"country"`
	// IPODate is YYYY-MM-DD, empty when unknown.
	IPODate           string     `json:"ipoDate"`
	Website           string     `json:"website"`
	SharesOutstanding *float64   `json:"sharesOutstanding"`
	Metrics           KeyMetrics `json:"metrics"`
}

// KeyMetrics are the vendor's valuation and financial ratios. Money is in the
// listing currency, percentages are in percent units (12.5 means 12.5%), and
// TTM means the trailing twelve months.
type KeyMetrics struct {
	MarketCap       *float64 `json:"marketCap"`
	EnterpriseValue *float64 `json:"enterpriseValue"`
	PE              *float64 `json:"peTTM"`
	PS              *float64 `json:"psTTM"`
	PB              *float64 `json:"pb"`
	EPS             *float64 `json:"epsTTM"`
	// RevenueGrowthYoY compares the last twelve months with the twelve before;
	// RevenueGrowth5Y is the five-year compound annual rate.
	RevenueGrowthYoY *float64 `json:"revenueGrowthYoY"`
	RevenueGrowth5Y  *float64 `json:"revenueGrowth5Y"`
	EPSGrowthYoY     *float64 `json:"epsGrowthYoY"`
	GrossMargin      *float64 `json:"grossMarginTTM"`
	OperatingMargin  *float64 `json:"operatingMarginTTM"`
	NetMargin        *float64 `json:"netMarginTTM"`
	ROE              *float64 `json:"roeTTM"`
	CurrentRatio     *float64 `json:"currentRatio"`
	DebtToEquity     *float64 `json:"debtToEquity"`
	DividendYield    *float64 `json:"dividendYield"`
	PayoutRatio      *float64 `json:"payoutRatioTTM"`
	Beta             *float64 `json:"beta"`
	// Price returns in percent, and the S&P 500's over the same period.
	PriceReturnYTD   *float64 `json:"priceReturnYTD"`
	PriceReturn1Y    *float64 `json:"priceReturn1Y"`
	SP500ReturnYTD   *float64 `json:"sp500ReturnYTD"`
	SP500Return1Y    *float64 `json:"sp500Return1Y"`
	FiftyTwoWeekHigh *float64 `json:"fiftyTwoWeekHigh"`
	FiftyTwoWeekLow  *float64 `json:"fiftyTwoWeekLow"`
	// FiftyTwoWeekHighDate and FiftyTwoWeekLowDate are YYYY-MM-DD, empty when unknown.
	FiftyTwoWeekHighDate string `json:"fiftyTwoWeekHighDate"`
	FiftyTwoWeekLowDate  string `json:"fiftyTwoWeekLowDate"`
}

// EarningsSurprise is one reported quarter: actual EPS against the analysts'
// consensus estimate.
type EarningsSurprise struct {
	// Period is the end of the fiscal quarter (YYYY-MM-DD). Year and Quarter
	// are fiscal, so they can differ from the calendar (Apple's Q3 ends in June).
	Period   string   `json:"period"`
	Year     int      `json:"year"`
	Quarter  int      `json:"quarter"`
	Actual   *float64 `json:"actual"`
	Estimate *float64 `json:"estimate"`
	// Surprise is Actual - Estimate; SurprisePercent is that as a percentage
	// of the estimate's size, so a smaller loss than expected is positive.
	Surprise        *float64 `json:"surprise"`
	SurprisePercent *float64 `json:"surprisePercent"`
}

// RecommendationTrend counts the analyst ratings in effect for one month.
type RecommendationTrend struct {
	// Period is the first day of the month (YYYY-MM-DD).
	Period     string `json:"period"`
	StrongBuy  int    `json:"strongBuy"`
	Buy        int    `json:"buy"`
	Hold       int    `json:"hold"`
	Sell       int    `json:"sell"`
	StrongSell int    `json:"strongSell"`
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
	// EarningsHistory returns the latest reported quarters, newest first.
	EarningsHistory(ctx context.Context, symbol Symbol) ([]EarningsSurprise, error)
}

// FundamentalsProvider is implemented by vendors that publish company profiles
// and financial ratios.
type FundamentalsProvider interface {
	Fundamentals(ctx context.Context, symbol Symbol) (Fundamentals, error)
	// Recommendations returns monthly analyst rating counts, newest first.
	Recommendations(ctx context.Context, symbol Symbol) ([]RecommendationTrend, error)
}

// Composite takes quotes, search, earnings and fundamentals from one vendor and candles and
// market status from another. It is used when a second vendor's free plan
// has a far larger request allowance but no historical bars.
type Composite struct {
	// QuoteSource serves quotes, search and, when it implements the matching
	// interfaces, earnings and fundamentals.
	QuoteSource Provider
	// BarSource serves candles and market status.
	BarSource Provider
}

var (
	_ Provider             = Composite{}
	_ MultiSource          = Composite{}
	_ EarningsProvider     = Composite{}
	_ FundamentalsProvider = Composite{}
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

// EarningsHistory implements EarningsProvider through the quotes vendor.
func (c Composite) EarningsHistory(ctx context.Context, symbol Symbol) ([]EarningsSurprise, error) {
	if e, ok := c.QuoteSource.(EarningsProvider); ok && c.QuoteSource.Configured() {
		return e.EarningsHistory(ctx, symbol)
	}
	return nil, ErrNotConfigured
}

// Fundamentals implements FundamentalsProvider through the quotes vendor.
func (c Composite) Fundamentals(ctx context.Context, symbol Symbol) (Fundamentals, error) {
	if f, ok := c.QuoteSource.(FundamentalsProvider); ok && c.QuoteSource.Configured() {
		return f.Fundamentals(ctx, symbol)
	}
	return Fundamentals{}, ErrNotConfigured
}

// Recommendations implements FundamentalsProvider through the quotes vendor.
func (c Composite) Recommendations(ctx context.Context, symbol Symbol) ([]RecommendationTrend, error) {
	if f, ok := c.QuoteSource.(FundamentalsProvider); ok && c.QuoteSource.Configured() {
		return f.Recommendations(ctx, symbol)
	}
	return nil, ErrNotConfigured
}
