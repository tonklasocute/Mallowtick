package market

import (
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

// Symbol is a validated, upper-cased US ticker such as "AAPL" or "BRK.B".
type Symbol string

var symbolPattern = regexp.MustCompile(`^[A-Z][A-Z0-9]{0,6}([.\-][A-Z0-9]{1,3})?$`)

// ParseSymbol normalizes and validates a ticker.
func ParseSymbol(raw string) (Symbol, error) {
	s := strings.ToUpper(strings.TrimSpace(raw))
	if !symbolPattern.MatchString(s) {
		return "", fmt.Errorf("%w: %q is not a valid US ticker symbol", ErrInvalidInput, raw)
	}
	return Symbol(s), nil
}

// MaxBatchSymbols bounds a single batch quote request.
const MaxBatchSymbols = 25

// ParseSymbolList parses a comma-separated list, dropping duplicates while
// keeping the caller's order.
func ParseSymbolList(raw string) ([]Symbol, error) {
	parts := strings.Split(raw, ",")
	out := make([]Symbol, 0, len(parts))
	seen := make(map[Symbol]bool, len(parts))
	for _, p := range parts {
		if strings.TrimSpace(p) == "" {
			continue
		}
		s, err := ParseSymbol(p)
		if err != nil {
			return nil, err
		}
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("%w: at least one symbol is required", ErrInvalidInput)
	}
	if len(out) > MaxBatchSymbols {
		return nil, fmt.Errorf("%w: at most %d symbols per request", ErrInvalidInput, MaxBatchSymbols)
	}
	return out, nil
}

var searchPattern = regexp.MustCompile(`^[\p{L}\p{N} .,&'\-]+$`)

// ParseSearchQuery validates a free-text symbol or company-name query.
func ParseSearchQuery(raw string) (string, error) {
	q := strings.Join(strings.Fields(raw), " ")
	if q == "" {
		return "", fmt.Errorf("%w: search query is required", ErrInvalidInput)
	}
	if utf8.RuneCountInString(q) > 40 {
		return "", fmt.Errorf("%w: search query must be at most 40 characters", ErrInvalidInput)
	}
	if !searchPattern.MatchString(q) {
		return "", fmt.Errorf("%w: search query contains unsupported characters", ErrInvalidInput)
	}
	return q, nil
}

// Interval is a candle width understood by providers.
type Interval string

const (
	Interval5Min  Interval = "5min"
	Interval30Min Interval = "30min"
	Interval1Hour Interval = "1h"
	Interval1Day  Interval = "1day"
	Interval1Week Interval = "1week"
)

// Range is a chart timeframe selectable in the UI.
type Range string

const (
	Range1D Range = "1d"
	Range1W Range = "1w"
	Range1M Range = "1m"
	Range3M Range = "3m"
	Range1Y Range = "1y"
	Range5Y Range = "5y"
)

// RangeSpec maps a Range to the provider request that covers it.
type RangeSpec struct {
	Interval Interval
	// Bars is the number of most recent bars requested. Intraday counts assume
	// regular US sessions (6.5 hours), so a range may span slightly more or
	// less calendar time around holidays and half days.
	Bars int
	// CacheTTL is how long a fetched series is reused while the market is open;
	// roughly one bar, since a refetch sooner adds little. Closed-market series
	// are kept until the next open.
	CacheTTL time.Duration
}

var rangeSpecs = map[Range]RangeSpec{
	Range1D: {Interval: Interval5Min, Bars: 78, CacheTTL: 5 * time.Minute},   // 1 session × 78 five-minute bars
	Range1W: {Interval: Interval30Min, Bars: 65, CacheTTL: 15 * time.Minute}, // 5 sessions × 13 bars
	Range1M: {Interval: Interval1Day, Bars: 22, CacheTTL: time.Hour},         // ~22 sessions
	Range3M: {Interval: Interval1Day, Bars: 63, CacheTTL: time.Hour},
	Range1Y: {Interval: Interval1Day, Bars: 252, CacheTTL: time.Hour},
	Range5Y: {Interval: Interval1Week, Bars: 260, CacheTTL: 6 * time.Hour},
}

// WarmupBars are fetched before a range's bars in the same request (Twelve
// Data charges one credit per request regardless of size) so indicators such
// as a 300-bar EMA have converged by the first visible bar. Three times the
// longest supported period leaves the seed's influence below 0.3%.
const WarmupBars = 900

// Ranges lists supported ranges in display order.
var Ranges = []Range{Range1D, Range1W, Range1M, Range3M, Range1Y, Range5Y}

// ParseRange validates a range; an empty string selects the default.
func ParseRange(raw string, def Range) (Range, error) {
	if strings.TrimSpace(raw) == "" {
		return def, nil
	}
	r := Range(strings.ToLower(strings.TrimSpace(raw)))
	if _, ok := rangeSpecs[r]; !ok {
		return "", fmt.Errorf("%w: unsupported range %q (use 1d, 1w, 1m, 3m, 1y or 5y)", ErrInvalidInput, raw)
	}
	return r, nil
}

// Spec returns the provider request for r. r must come from ParseRange.
func (r Range) Spec() RangeSpec { return rangeSpecs[r] }
