package market

import (
	"fmt"
	"regexp"
	"strconv"
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
	// Bars is the number of most recent bars the range shows. Intraday counts
	// assume regular US sessions (6.5 hours), so a range may span slightly more
	// or less calendar time around holidays and half days.
	Bars int
	// CacheTTL is how long a fetched series is reused while the market is open;
	// roughly one bar, since a refetch sooner adds little. Closed-market series
	// are kept until the next open. Daily ranges share one series (dailySeries)
	// that is kept until the close instead, so for them CacheTTL applies only
	// while the market status is not cached.
	CacheTTL time.Duration
}

// dailyCacheTTL is how long the shared daily series is kept when the cached
// market status cannot tell when the session ends.
const dailyCacheTTL = time.Hour

var rangeSpecs = map[Range]RangeSpec{
	Range1D: {Interval: Interval5Min, Bars: 78, CacheTTL: 5 * time.Minute},   // 1 session × 78 five-minute bars
	Range1W: {Interval: Interval30Min, Bars: 65, CacheTTL: 15 * time.Minute}, // 5 sessions × 13 bars
	Range1M: {Interval: Interval1Day, Bars: 22, CacheTTL: dailyCacheTTL},     // ~22 sessions
	Range3M: {Interval: Interval1Day, Bars: 63, CacheTTL: dailyCacheTTL},
	Range1Y: {Interval: Interval1Day, Bars: 252, CacheTTL: dailyCacheTTL},
	Range5Y: {Interval: Interval1Week, Bars: 260, CacheTTL: 6 * time.Hour},
}

// dailySeries is the one request behind every daily range: as many bars as the
// longest one, so 1M, 3M and 1Y slice the same cached series and cost one
// credit together instead of one each.
var dailySeries = func() RangeSpec {
	spec := RangeSpec{Interval: Interval1Day, CacheTTL: dailyCacheTTL}
	for _, rs := range rangeSpecs {
		if rs.Interval == Interval1Day {
			spec.Bars = max(spec.Bars, rs.Bars)
		}
	}
	return spec
}()

// WarmupBars are fetched before a range's bars in the same request (Twelve
// Data charges one credit per request regardless of size) so indicators such
// as a 300-bar EMA have converged by the first visible bar. Three times the
// longest supported period leaves the seed's influence below 0.3%. Ranges cut
// from dailySeries get the WarmupBars right before their own bars.
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

// MaxFilterSymbols bounds a symbol filter: a watchlist and a portfolio of
// MaxBatchSymbols each.
const MaxFilterSymbols = 2 * MaxBatchSymbols

// ParseSymbolFilter parses an optional comma-separated filter: empty means no
// filter, and at most MaxFilterSymbols are accepted.
func ParseSymbolFilter(raw string) ([]Symbol, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	parts := strings.Split(raw, ",")
	if len(parts) > MaxFilterSymbols {
		return nil, fmt.Errorf("%w: at most %d symbols per request", ErrInvalidInput, MaxFilterSymbols)
	}
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
	return out, nil
}

// ParseDate validates a YYYY-MM-DD date; empty gives def.
func ParseDate(raw, def string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return def, nil
	}
	t, err := time.Parse(time.DateOnly, raw)
	if err != nil {
		return "", fmt.Errorf("%w: %q is not a date like 2026-11-18", ErrInvalidInput, raw)
	}
	return t.Format(time.DateOnly), nil
}

// ParseCalendarRange validates an earnings calendar range around today
// (YYYY-MM-DD). Defaults: today through the next 13 days.
func ParseCalendarRange(rawFrom, rawTo, today string) (from, to string, err error) {
	if from, err = ParseDate(rawFrom, today); err != nil {
		return "", "", err
	}
	if to, err = ParseDate(rawTo, AddDays(from, 13)); err != nil {
		return "", "", err
	}
	switch {
	case to < from:
		return "", "", fmt.Errorf("%w: to must not be before from", ErrInvalidInput)
	case daysBetween(from, to) >= CalendarMaxDays:
		return "", "", fmt.Errorf("%w: at most %d days per request", ErrInvalidInput, CalendarMaxDays)
	case from < AddDays(today, -CalendarReachDays) || to > AddDays(today, CalendarReachDays):
		return "", "", fmt.Errorf("%w: dates must be within %d days of today", ErrInvalidInput, CalendarReachDays)
	}
	return from, to, nil
}

// NewsParams are the raw query parameters of GET /news.
type NewsParams struct {
	Symbols, Category, From, To, Page, Limit string
}

// ParseNewsQuery validates GET /news parameters. Company news (symbols) can be
// filtered within the last NewsWindowDays; market news has no date bound of its own.
func ParseNewsQuery(p NewsParams, today string) (NewsQuery, error) {
	symbols, err := ParseSymbolFilter(p.Symbols)
	if err != nil {
		return NewsQuery{}, err
	}
	if len(symbols) > NewsMaxSymbols {
		return NewsQuery{}, fmt.Errorf("%w: at most %d symbols per news request", ErrInvalidInput, NewsMaxSymbols)
	}
	q := NewsQuery{Symbols: symbols}
	switch c := strings.ToLower(strings.TrimSpace(p.Category)); c {
	case "", NewsGeneral, NewsMerger:
		q.Category = c
	case "company":
		if len(symbols) == 0 {
			return NewsQuery{}, fmt.Errorf("%w: company news needs symbols", ErrInvalidInput)
		}
	default:
		return NewsQuery{}, fmt.Errorf("%w: category must be general, merger or company", ErrInvalidInput)
	}
	if len(symbols) > 0 {
		q.Category = ""
	}
	if q.From, err = ParseDate(p.From, ""); err != nil {
		return NewsQuery{}, err
	}
	if q.To, err = ParseDate(p.To, ""); err != nil {
		return NewsQuery{}, err
	}
	if q.From != "" && q.To != "" && q.To < q.From {
		return NewsQuery{}, fmt.Errorf("%w: to must not be before from", ErrInvalidInput)
	}
	if q.From != "" && q.From < AddDays(today, -30) {
		return NewsQuery{}, fmt.Errorf("%w: news goes back 30 days at most", ErrInvalidInput)
	}
	if q.Page, err = boundedInt(p.Page, "page", 1, 1, 100); err != nil {
		return NewsQuery{}, err
	}
	if q.Limit, err = boundedInt(p.Limit, "limit", NewsDefaultLimit, 1, NewsMaxLimit); err != nil {
		return NewsQuery{}, err
	}
	return q, nil
}

func boundedInt(raw, name string, def, lo, hi int) (int, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return def, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < lo || n > hi {
		return 0, fmt.Errorf("%w: %s must be a whole number from %d to %d", ErrInvalidInput, name, lo, hi)
	}
	return n, nil
}

var articleIDPattern = regexp.MustCompile(`^[a-z]{2}-[0-9A-Za-z]{1,40}$`)

// ParseArticleID validates a news article id such as "fh-143886409".
func ParseArticleID(raw string) (string, error) {
	if !articleIDPattern.MatchString(raw) {
		return "", fmt.Errorf("%w: %q is not an article id", ErrInvalidInput, raw)
	}
	return raw, nil
}
