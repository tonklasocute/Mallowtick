// Package market holds the vendor-independent market-data domain: the types the
// API exposes, the Provider boundary that vendor adapters implement, and the
// Service that adds caching, freshness metadata, and derived analytics.
package market

import (
	"time"
)

// Latency is the delivery latency of a provider's data as declared by the
// operator for their plan. It is configuration, never inferred from a response.
type Latency string

const (
	LatencyRealtime Latency = "realtime"
	LatencyDelayed  Latency = "delayed"
	LatencyEndOfDay Latency = "eod"
	LatencyUnknown  Latency = "unknown"
)

// ParseLatency validates a configured latency value.
func ParseLatency(s string) (Latency, bool) {
	switch l := Latency(s); l {
	case LatencyRealtime, LatencyDelayed, LatencyEndOfDay, LatencyUnknown:
		return l, true
	}
	return "", false
}

// Instrument identifies a tradable US security.
type Instrument struct {
	Symbol   string `json:"symbol"`
	Name     string `json:"name"`
	Exchange string `json:"exchange"`
	MICCode  string `json:"micCode,omitempty"`
	Currency string `json:"currency,omitempty"`
	Type     string `json:"type,omitempty"`
	Country  string `json:"country,omitempty"`
}

// Quote is the latest available trading data for one symbol as reported by
// the provider. Optional fields are pointers so "not reported" stays distinct
// from zero.
type Quote struct {
	Symbol        string   `json:"symbol"`
	Name          string   `json:"name"`
	Exchange      string   `json:"exchange"`
	Currency      string   `json:"currency"`
	Price         float64  `json:"price"`
	Open          *float64 `json:"open"`
	High          *float64 `json:"high"`
	Low           *float64 `json:"low"`
	PreviousClose *float64 `json:"previousClose"`
	Change        *float64 `json:"change"`
	ChangePercent *float64 `json:"changePercent"`
	Volume        *int64   `json:"volume"`
	FiftyTwoWeek  *Range52 `json:"fiftyTwoWeek"`
	IsMarketOpen  *bool    `json:"isMarketOpen"`
	// AsOf is the provider-reported time of the last quote. Nil when the
	// provider did not report one; it is never filled in with the fetch time.
	AsOf *time.Time `json:"asOf"`
}

// Range52 is the 52-week trading range.
type Range52 struct {
	Low  float64 `json:"low"`
	High float64 `json:"high"`
}

// Candle is one OHLCV bar. Time is the bar's opening instant.
type Candle struct {
	Time   time.Time `json:"time"`
	Open   float64   `json:"open"`
	High   float64   `json:"high"`
	Low    float64   `json:"low"`
	Close  float64   `json:"close"`
	Volume *int64    `json:"volume"`
}

// CandleSeries is a provider response for one symbol and interval, oldest first.
type CandleSeries struct {
	Symbol           string   `json:"symbol"`
	Interval         Interval `json:"interval"`
	Currency         string   `json:"currency,omitempty"`
	ExchangeTimezone string   `json:"exchangeTimezone"`
	Candles          []Candle `json:"candles"`
}

// MarketStatus describes whether the primary US equity market is open.
type MarketStatus struct {
	Exchange string `json:"exchange"`
	Name     string `json:"name"`
	IsOpen   bool   `json:"isOpen"`
	// OpensInSeconds / ClosesInSeconds are provider-reported countdowns, nil
	// when not applicable or not reported.
	OpensInSeconds  *int64 `json:"opensInSeconds"`
	ClosesInSeconds *int64 `json:"closesInSeconds"`
}

// Freshness describes where a response came from and how current it is.
type Freshness struct {
	Provider string  `json:"provider"`
	Latency  Latency `json:"latency"`
	// AsOf is the provider timestamp of the data, when known.
	AsOf *time.Time `json:"asOf"`
	// FetchedAt is when this API server received the data from the provider.
	FetchedAt time.Time `json:"fetchedAt"`
	// Stale is true when the provider request failed and a previously fetched
	// value is being served instead.
	Stale bool `json:"stale"`
}
