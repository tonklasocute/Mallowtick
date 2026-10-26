package market

import (
	"context"
	"errors"
)

// Errors returned by providers and the service. Adapters wrap these so callers
// can map them with errors.Is without knowing the vendor.
var (
	ErrInvalidInput  = errors.New("invalid input")
	ErrNotFound      = errors.New("not found")
	ErrNotConfigured = errors.New("market data provider is not configured")
	ErrRateLimited   = errors.New("market data provider rate limit reached")
	ErrUnauthorized  = errors.New("market data provider rejected the credentials")
	ErrNotEntitled   = errors.New("market data plan does not include this data")
	ErrUnavailable   = errors.New("market data provider unavailable")
)

// Provider is the boundary every market-data vendor adapter implements.
// Implementations must be safe for concurrent use.
type Provider interface {
	// Name is a stable identifier such as "twelvedata".
	Name() string
	// Configured reports whether credentials are present.
	Configured() bool
	// SearchSymbols matches tickers and company names among US instruments.
	SearchSymbols(ctx context.Context, query string, limit int) ([]Instrument, error)
	// Quotes returns the latest quote per requested symbol. Symbols the
	// provider could not resolve are absent from the map.
	Quotes(ctx context.Context, symbols []Symbol) (map[Symbol]Quote, error)
	// Candles returns the most recent bars for symbol, oldest first.
	Candles(ctx context.Context, symbol Symbol, interval Interval, bars int) (CandleSeries, error)
	// MarketStatus reports whether the primary US equity market is open.
	MarketStatus(ctx context.Context) (MarketStatus, error)
}

// Unconfigured is the Provider used when no credentials are set. It lets the
// API start and report ErrNotConfigured instead of serving substitute data.
type Unconfigured struct{ ProviderName string }

func (u Unconfigured) Name() string   { return u.ProviderName }
func (Unconfigured) Configured() bool { return false }
func (Unconfigured) SearchSymbols(context.Context, string, int) ([]Instrument, error) {
	return nil, ErrNotConfigured
}
func (Unconfigured) Quotes(context.Context, []Symbol) (map[Symbol]Quote, error) {
	return nil, ErrNotConfigured
}
func (Unconfigured) Candles(context.Context, Symbol, Interval, int) (CandleSeries, error) {
	return CandleSeries{}, ErrNotConfigured
}
func (Unconfigured) MarketStatus(context.Context) (MarketStatus, error) {
	return MarketStatus{}, ErrNotConfigured
}
