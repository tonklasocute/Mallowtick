package market

import (
	"cmp"
	"context"
	"errors"
	"time"

	"golang.org/x/sync/errgroup"

	"github.com/tonklasocute/mallowtick/services/api/internal/cache"
)

// Sector is one of the eleven S&P 500 (GICS) sectors, tracked through its SPDR
// Select Sector ETF. ID is a stable English key; clients name it in their language.
type Sector struct {
	ID     string
	Symbol Symbol
}

// Sectors lists the S&P 500 sectors in GICS order.
var Sectors = []Sector{
	{"energy", "XLE"},
	{"materials", "XLB"},
	{"industrials", "XLI"},
	{"consumer-discretionary", "XLY"},
	{"consumer-staples", "XLP"},
	{"health-care", "XLV"},
	{"financials", "XLF"},
	{"technology", "XLK"},
	{"communication-services", "XLC"},
	{"utilities", "XLU"},
	{"real-estate", "XLRE"},
}

// SectorBenchmark is the S&P 500 ETF the sectors are compared with.
const SectorBenchmark Symbol = "SPY"

// sectorFetches bounds concurrent fundamentals lookups for the sector list.
const sectorFetches = 4

// PriceReturns are price returns in percent per period, nil when the vendor
// reported none. 1d is the latest session's change; the rest come from the
// vendor's daily-close returns (1w is five sessions, 3m is 13 weeks).
type PriceReturns struct {
	Day     *float64 `json:"1d"`
	Week    *float64 `json:"1w"`
	Quarter *float64 `json:"3m"`
	YTD     *float64 `json:"ytd"`
	Year    *float64 `json:"1y"`
}

// SectorPerformance is one sector's (or the benchmark's) returns.
type SectorPerformance struct {
	// Sector is the Sector.ID, empty for the benchmark.
	Sector  string       `json:"sector,omitempty"`
	Symbol  Symbol       `json:"symbol"`
	Returns PriceReturns `json:"returns"`
}

// SectorsResult compares the sectors with the S&P 500. Benchmark is nil when
// SPY could not be fetched. Sectors are in Sectors order. Unavailable lists the
// symbols missing their quote, their returns or both; only the last are left
// out of Sectors.
type SectorsResult struct {
	Benchmark   *SectorPerformance  `json:"benchmark"`
	Sectors     []SectorPerformance `json:"sectors"`
	Unavailable []UnavailableSymbol `json:"unavailable"`
	Freshness   Freshness           `json:"freshness"`
}

// Sectors returns each sector's price returns next to the S&P 500's, from a
// vendor that reports performance on its own (Finnhub); it fails with
// ErrNotConfigured without one, which also keeps it off Twelve Data alone,
// whose quotes cost a credit per symbol. It skips the name and profile lookups
// of quotes and fundamentals, which on a cold start would add two calls per
// ETF and push the first Discover load past 60 calls a minute. That leaves 11
// quote calls per QuoteTTL (SPY comes from the quote cache when the overview
// has it) and 12 metric calls per fundamentalsTTL.
func (s *Service) Sectors(ctx context.Context) (SectorsResult, error) {
	pp, ok := s.source(KindFundamentals).(PerformanceProvider)
	if !ok {
		return SectorsResult{}, ErrNotConfigured
	}
	symbols := []Symbol{SectorBenchmark}
	for _, sec := range Sectors {
		symbols = append(symbols, sec.Symbol)
	}

	// A full quote already cached (SPY, from the overview) serves as well.
	bySymbol := make(map[Symbol]QuoteResult, len(symbols))
	var misses []Symbol
	for _, sym := range symbols {
		if e, state := s.quotes.Get(string(sym)); state == cache.Fresh {
			bySymbol[sym] = QuoteResult{Quote: e.Value, Freshness: s.freshness(KindQuotes, e.Value.AsOf, e.StoredAt, false)}
		} else {
			misses = append(misses, sym)
		}
	}
	quotes, quoteErrs := s.resolveQuotesFrom(ctx, misses, s.dayChanges, "daychanges:", pp.DayChanges)
	for _, q := range quotes {
		bySymbol[Symbol(q.Symbol)] = q
	}
	returns := make([]cache.Entry[PriceReturns], len(symbols))
	returnsStale := make([]bool, len(symbols))
	returnErrs := make([]error, len(symbols))
	var g errgroup.Group
	g.SetLimit(sectorFetches)
	for i, sym := range symbols {
		g.Go(func() error {
			returns[i], returnsStale[i], returnErrs[i] = load(ctx, s, s.returns, "returns:"+string(sym),
				fixedTTL[PriceReturns](fundamentalsTTL),
				func(fctx context.Context) (PriceReturns, error) { return pp.PriceReturns(fctx, sym) })
			return nil
		})
	}
	_ = g.Wait()

	res := SectorsResult{Sectors: []SectorPerformance{}, Unavailable: []UnavailableSymbol{}}
	var (
		asOf, fetchedAt *time.Time
		stale           bool
		firstErr        error
	)
	seen := func(f Freshness) {
		stale = stale || f.Stale
		if f.AsOf != nil && (asOf == nil || f.AsOf.After(*asOf)) {
			asOf = f.AsOf
		}
		// The oldest fetch, so the response never looks fresher than its parts.
		if fetchedAt == nil || f.FetchedAt.Before(*fetchedAt) {
			t := f.FetchedAt
			fetchedAt = &t
		}
	}
	for i, sym := range symbols {
		q, hasQuote := bySymbol[sym]
		hasReturns := returnErrs[i] == nil
		if !hasQuote && !hasReturns {
			err := returnErrs[i]
			if qe := quoteErrs[sym]; qe != nil && !errors.Is(qe, ErrNotFound) {
				err = qe
			}
			if firstErr == nil && !errors.Is(err, ErrNotFound) {
				firstErr = err
			}
			res.Unavailable = append(res.Unavailable, UnavailableSymbol{Symbol: sym, Reason: ErrorCode(err)})
			continue
		}
		// Half a row (e.g. the day's change without the longer returns) is listed
		// too, so clients know to ask again; a cold start can exceed the vendor's
		// per-minute allowance for a minute.
		if partErr := cmp.Or(quoteErrs[sym], returnErrs[i]); partErr != nil && !errors.Is(partErr, ErrNotFound) {
			res.Unavailable = append(res.Unavailable, UnavailableSymbol{Symbol: sym, Reason: ErrorCode(partErr)})
		}
		perf := SectorPerformance{Symbol: sym}
		if hasQuote {
			perf.Returns.Day = q.ChangePercent
			seen(q.Freshness)
		}
		if hasReturns {
			r := returns[i].Value
			perf.Returns.Week, perf.Returns.Quarter, perf.Returns.YTD, perf.Returns.Year = r.Week, r.Quarter, r.YTD, r.Year
			// Returns carry no data time; they only age the response.
			seen(s.freshness(KindFundamentals, nil, returns[i].StoredAt, returnsStale[i]))
		}
		if i == 0 {
			res.Benchmark = &perf
		} else {
			perf.Sector = Sectors[i-1].ID
			res.Sectors = append(res.Sectors, perf)
		}
	}
	if res.Benchmark == nil && len(res.Sectors) == 0 {
		if firstErr == nil {
			firstErr = ErrNotFound
		}
		return SectorsResult{}, firstErr
	}
	res.Freshness = s.freshness(KindFundamentals, asOf, *fetchedAt, stale)
	return res, nil
}
