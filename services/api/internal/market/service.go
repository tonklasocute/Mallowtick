package market

import (
	"context"
	"errors"
	"log/slog"
	"slices"
	"strings"
	"time"

	"golang.org/x/sync/singleflight"

	"github.com/tonklasocute/mallowtick/services/api/internal/cache"
	"github.com/tonklasocute/mallowtick/services/api/internal/supportresistance"
)

// ServiceConfig configures caching and the curated symbol lists.
type ServiceConfig struct {
	Latency Latency
	// QuoteTTL applies while the market is open or its state is unknown;
	// QuoteTTLClosed applies to quotes reporting a closed market.
	QuoteTTL       time.Duration
	QuoteTTLClosed time.Duration
	// StaleRetention is how long expired values are kept as a fallback for
	// provider failures. Fallback responses are always marked stale.
	StaleRetention  time.Duration
	ProviderTimeout time.Duration
	OverviewSymbols []Symbol
	PopularSymbols  []Symbol
	Levels          supportresistance.Config
	Logger          *slog.Logger
	Now             func() time.Time
}

const (
	searchTTL     = 10 * time.Minute
	instrumentTTL = 24 * time.Hour
	statusTTL     = time.Minute
	searchLimit   = 10
)

// Service is the application layer between transports and a Provider.
type Service struct {
	provider Provider
	cfg      ServiceConfig
	log      *slog.Logger
	group    singleflight.Group

	quotes      *cache.TTL[Quote]
	candles     *cache.TTL[CandleSeries]
	searches    *cache.TTL[[]Instrument]
	instruments *cache.TTL[Instrument]
	status      *cache.TTL[MarketStatus]
}

// NewService wires a provider with caches.
func NewService(p Provider, cfg ServiceConfig) *Service {
	if cfg.Logger == nil {
		cfg.Logger = slog.New(slog.DiscardHandler)
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	retain := cfg.StaleRetention
	return &Service{
		provider:    p,
		cfg:         cfg,
		log:         cfg.Logger,
		quotes:      cache.New[Quote](cfg.QuoteTTL, retain, 2000, cfg.Now),
		candles:     cache.New[CandleSeries](time.Minute, retain, 500, cfg.Now),
		searches:    cache.New[[]Instrument](searchTTL, retain, 1000, cfg.Now),
		instruments: cache.New[Instrument](instrumentTTL, instrumentTTL, 2000, cfg.Now),
		status:      cache.New[MarketStatus](statusTTL, retain, 1, cfg.Now),
	}
}

// ProviderInfo describes the configured provider.
type ProviderInfo struct {
	Name       string  `json:"name"`
	Configured bool    `json:"configured"`
	Latency    Latency `json:"latency"`
}

func (s *Service) ProviderInfo() ProviderInfo {
	return ProviderInfo{Name: s.provider.Name(), Configured: s.provider.Configured(), Latency: s.cfg.Latency}
}

// QuoteResult is a quote plus its freshness metadata.
type QuoteResult struct {
	Quote
	Freshness Freshness `json:"freshness"`
}

// UnavailableSymbol explains why a symbol is missing from a batch response.
type UnavailableSymbol struct {
	Symbol Symbol `json:"symbol"`
	Reason string `json:"reason"`
	// Group is set in overview responses: "benchmark" or "popular".
	Group string `json:"group,omitempty"`
}

// Overview groups for UnavailableSymbol.Group.
const (
	GroupBenchmark = "benchmark"
	GroupPopular   = "popular"
)

// QuoteBatch is the result of a multi-symbol quote lookup, in request order.
type QuoteBatch struct {
	Quotes      []QuoteResult       `json:"quotes"`
	Unavailable []UnavailableSymbol `json:"unavailable"`
}

// Overview groups the configured benchmark and popular symbols.
type Overview struct {
	Benchmarks  []QuoteResult       `json:"benchmarks"`
	Popular     []QuoteResult       `json:"popular"`
	Unavailable []UnavailableSymbol `json:"unavailable"`
}

// CandlesResult is a candle series for a UI range.
type CandlesResult struct {
	CandleSeries
	Range     Range     `json:"range"`
	Freshness Freshness `json:"freshness"`
}

// LevelsMethod documents how levels were derived.
type LevelsMethod struct {
	Name        string                   `json:"name"`
	Description string                   `json:"description"`
	Parameters  supportresistance.Config `json:"parameters"`
}

// LevelsResult is a support/resistance calculation for a symbol and range.
type LevelsResult struct {
	Symbol   Symbol   `json:"symbol"`
	Range    Range    `json:"range"`
	Interval Interval `json:"interval"`
	supportresistance.Result
	Method     LevelsMethod `json:"method"`
	ComputedAt time.Time    `json:"computedAt"`
	Disclaimer string       `json:"disclaimer"`
	// Freshness describes the candles the calculation used.
	Freshness Freshness `json:"freshness"`
}

// StatusResult is the market status with freshness metadata.
type StatusResult struct {
	MarketStatus
	Freshness Freshness `json:"freshness"`
}

const levelsDisclaimer = "Levels are calculated by Mallowtick from historical candles. They are analytical estimates, not provider data, and do not predict future prices."

func (s *Service) freshness(asOf *time.Time, fetchedAt time.Time, stale bool) Freshness {
	return Freshness{Provider: s.provider.Name(), Latency: s.cfg.Latency, AsOf: asOf, FetchedAt: fetchedAt.UTC(), Stale: stale}
}

// do runs fn once per key across concurrent callers. The provider call is
// detached from the first caller's cancellation so other waiters still get a
// result, and is bounded by ProviderTimeout.
func (s *Service) do(ctx context.Context, key string, fn func(context.Context) (any, error)) (any, error) {
	ch := s.group.DoChan(key, func() (any, error) {
		fctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), s.cfg.ProviderTimeout)
		defer cancel()
		return fn(fctx)
	})
	select {
	case r := <-ch:
		return r.Val, r.Err
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// canFallBack reports whether a stale cached value may replace a failed fetch.
func canFallBack(err error) bool {
	return !errors.Is(err, ErrNotFound) && !errors.Is(err, ErrInvalidInput)
}

// load returns a fresh cached value or fetches one, falling back to a stale
// value when the fetch fails. The bool result reports a stale fallback.
func load[V any](ctx context.Context, s *Service, c *cache.TTL[V], key string,
	ttl func(V) time.Duration, fetch func(context.Context) (V, error)) (cache.Entry[V], bool, error) {
	cached, state := c.Get(key)
	if state == cache.Fresh {
		return cached, false, nil
	}
	v, err := s.do(ctx, key, func(fctx context.Context) (any, error) {
		val, err := fetch(fctx)
		if err != nil {
			return nil, err
		}
		return c.SetWithTTL(key, val, ttl(val)), nil
	})
	if err == nil {
		return v.(cache.Entry[V]), false, nil
	}
	if state == cache.Stale && canFallBack(err) {
		s.log.WarnContext(ctx, "serving stale cached value", slog.String("key", key), slog.Any("error", err))
		return cached, true, nil
	}
	return cache.Entry[V]{}, false, err
}

func fixedTTL[V any](d time.Duration) func(V) time.Duration {
	return func(V) time.Duration { return d }
}

// Search finds US instruments by ticker or company name.
func (s *Service) Search(ctx context.Context, query string) ([]Instrument, error) {
	key := "search:" + strings.ToLower(query)
	e, _, err := load(ctx, s, s.searches, key, fixedTTL[[]Instrument](searchTTL), func(fctx context.Context) ([]Instrument, error) {
		return s.provider.SearchSymbols(fctx, query, searchLimit)
	})
	return e.Value, err
}

// Instrument resolves a symbol's descriptive metadata.
func (s *Service) Instrument(ctx context.Context, symbol Symbol) (Instrument, error) {
	e, _, err := load(ctx, s, s.instruments, "instrument:"+string(symbol), fixedTTL[Instrument](instrumentTTL),
		func(fctx context.Context) (Instrument, error) {
			matches, err := s.provider.SearchSymbols(fctx, string(symbol), searchLimit)
			if err != nil {
				return Instrument{}, err
			}
			for _, m := range matches {
				if strings.EqualFold(m.Symbol, string(symbol)) {
					return m, nil
				}
			}
			return Instrument{}, ErrNotFound
		})
	return e.Value, err
}

func (s *Service) quoteTTL(q Quote) time.Duration {
	if q.IsMarketOpen != nil && !*q.IsMarketOpen && s.cfg.QuoteTTLClosed > 0 {
		return s.cfg.QuoteTTLClosed
	}
	return s.cfg.QuoteTTL
}

// resolveQuotes resolves each symbol from cache or one provider request for all
// misses. It returns per-symbol errors for symbols it could not resolve.
func (s *Service) resolveQuotes(ctx context.Context, symbols []Symbol) ([]QuoteResult, map[Symbol]error) {
	results := make(map[Symbol]QuoteResult, len(symbols))
	staleEntries := make(map[Symbol]cache.Entry[Quote])
	var misses []Symbol
	for _, sym := range symbols {
		e, st := s.quotes.Get(string(sym))
		switch st {
		case cache.Fresh:
			results[sym] = QuoteResult{Quote: e.Value, Freshness: s.freshness(e.Value.AsOf, e.StoredAt, false)}
			continue
		case cache.Stale:
			staleEntries[sym] = e
		}
		misses = append(misses, sym)
	}

	errs := make(map[Symbol]error)
	if len(misses) > 0 {
		keys := make([]string, len(misses))
		for i, m := range misses {
			keys[i] = string(m)
		}
		v, fetchErr := s.do(ctx, "quotes:"+strings.Join(keys, ","), func(fctx context.Context) (any, error) {
			got, err := s.provider.Quotes(fctx, misses)
			if err != nil {
				return nil, err
			}
			stored := make(map[Symbol]cache.Entry[Quote], len(got))
			for sym, q := range got {
				stored[sym] = s.quotes.SetWithTTL(string(sym), q, s.quoteTTL(q))
			}
			return stored, nil
		})
		var fetched map[Symbol]cache.Entry[Quote]
		if fetchErr == nil {
			fetched = v.(map[Symbol]cache.Entry[Quote])
		}
		for _, sym := range misses {
			if e, ok := fetched[sym]; ok {
				results[sym] = QuoteResult{Quote: e.Value, Freshness: s.freshness(e.Value.AsOf, e.StoredAt, false)}
				continue
			}
			err := fetchErr
			if err == nil {
				err = ErrNotFound
			}
			if e, ok := staleEntries[sym]; ok && canFallBack(err) {
				s.log.WarnContext(ctx, "serving stale quote", slog.String("symbol", string(sym)), slog.Any("error", err))
				results[sym] = QuoteResult{Quote: e.Value, Freshness: s.freshness(e.Value.AsOf, e.StoredAt, true)}
				continue
			}
			errs[sym] = err
		}
	}

	ordered := make([]QuoteResult, 0, len(results))
	for _, sym := range symbols {
		if r, ok := results[sym]; ok {
			ordered = append(ordered, r)
		}
	}
	return ordered, errs
}

// Quote returns the latest quote for one symbol.
func (s *Service) Quote(ctx context.Context, symbol Symbol) (QuoteResult, error) {
	got, errs := s.resolveQuotes(ctx, []Symbol{symbol})
	if err := errs[symbol]; err != nil {
		return QuoteResult{}, err
	}
	return got[0], nil
}

// Quotes returns quotes for several symbols. It fails only when nothing could
// be resolved because of a provider-level error.
func (s *Service) Quotes(ctx context.Context, symbols []Symbol) (QuoteBatch, error) {
	got, errs := s.resolveQuotes(ctx, symbols)
	batch := QuoteBatch{Quotes: got, Unavailable: unavailable(symbols, errs)}
	if len(got) == 0 {
		if err := firstProviderError(symbols, errs); err != nil {
			return QuoteBatch{}, err
		}
	}
	return batch, nil
}

func unavailable(symbols []Symbol, errs map[Symbol]error) []UnavailableSymbol {
	out := []UnavailableSymbol{}
	for _, sym := range symbols {
		if err, ok := errs[sym]; ok {
			out = append(out, UnavailableSymbol{Symbol: sym, Reason: ErrorCode(err)})
		}
	}
	return out
}

func firstProviderError(symbols []Symbol, errs map[Symbol]error) error {
	for _, sym := range symbols {
		if err := errs[sym]; err != nil && !errors.Is(err, ErrNotFound) {
			return err
		}
	}
	return nil
}

// Overview returns quotes for the configured benchmark and popular symbols in
// a single provider request.
func (s *Service) Overview(ctx context.Context) (Overview, error) {
	ov := Overview{Benchmarks: []QuoteResult{}, Popular: []QuoteResult{}, Unavailable: []UnavailableSymbol{}}
	all := make([]Symbol, 0, len(s.cfg.OverviewSymbols)+len(s.cfg.PopularSymbols))
	seen := make(map[Symbol]bool)
	for _, sym := range append(slices.Clone(s.cfg.OverviewSymbols), s.cfg.PopularSymbols...) {
		if !seen[sym] {
			seen[sym] = true
			all = append(all, sym)
		}
	}
	if len(all) == 0 {
		return ov, nil
	}
	batch, err := s.Quotes(ctx, all)
	if err != nil {
		return Overview{}, err
	}
	bySymbol := make(map[string]QuoteResult, len(batch.Quotes))
	for _, q := range batch.Quotes {
		bySymbol[q.Symbol] = q
	}
	reasons := make(map[Symbol]string, len(batch.Unavailable))
	for _, u := range batch.Unavailable {
		reasons[u.Symbol] = u.Reason
	}
	// Keep each list in configured order and say which section a missing
	// symbol belongs to, so clients can show it in place.
	collect := func(symbols []Symbol, group string, dst *[]QuoteResult) {
		for _, sym := range symbols {
			if q, ok := bySymbol[string(sym)]; ok {
				*dst = append(*dst, q)
			} else if reason, ok := reasons[sym]; ok {
				ov.Unavailable = append(ov.Unavailable, UnavailableSymbol{Symbol: sym, Reason: reason, Group: group})
			}
		}
	}
	collect(s.cfg.OverviewSymbols, GroupBenchmark, &ov.Benchmarks)
	collect(s.cfg.PopularSymbols, GroupPopular, &ov.Popular)
	return ov, nil
}

// Candles returns the bars covering a UI range.
func (s *Service) Candles(ctx context.Context, symbol Symbol, rng Range) (CandlesResult, error) {
	spec := rng.Spec()
	key := "candles:" + string(symbol) + ":" + string(rng)
	e, stale, err := load(ctx, s, s.candles, key, fixedTTL[CandleSeries](spec.CacheTTL), func(fctx context.Context) (CandleSeries, error) {
		return s.provider.Candles(fctx, symbol, spec.Interval, spec.Bars)
	})
	if err != nil {
		return CandlesResult{}, err
	}
	var asOf *time.Time
	if n := len(e.Value.Candles); n > 0 {
		t := e.Value.Candles[n-1].Time
		asOf = &t
	}
	return CandlesResult{CandleSeries: e.Value, Range: rng, Freshness: s.freshness(asOf, e.StoredAt, stale)}, nil
}

// Levels computes support and resistance from the same candles the chart for
// rng displays.
func (s *Service) Levels(ctx context.Context, symbol Symbol, rng Range) (LevelsResult, error) {
	cr, err := s.Candles(ctx, symbol, rng)
	if err != nil {
		return LevelsResult{}, err
	}
	in := make([]supportresistance.Candle, len(cr.Candles))
	for i, c := range cr.Candles {
		in[i] = supportresistance.Candle{Time: c.Time, Open: c.Open, High: c.High, Low: c.Low, Close: c.Close}
	}
	res, err := supportresistance.Compute(in, s.cfg.Levels)
	if err != nil {
		return LevelsResult{}, err
	}
	return LevelsResult{
		Symbol: symbol, Range: rng, Interval: cr.Interval, Result: res,
		Method: LevelsMethod{
			Name:        "swing-cluster-v1",
			Description: "Confirmed swing highs/lows clustered within an ATR-based tolerance, scored by touches, recency and reaction strength.",
			Parameters:  s.cfg.Levels,
		},
		ComputedAt: s.cfg.Now().UTC(),
		Disclaimer: levelsDisclaimer,
		Freshness:  cr.Freshness,
	}, nil
}

// MarketStatus reports whether the US equity market is open.
func (s *Service) MarketStatus(ctx context.Context) (StatusResult, error) {
	e, stale, err := load(ctx, s, s.status, "status", fixedTTL[MarketStatus](statusTTL), s.provider.MarketStatus)
	if err != nil {
		return StatusResult{}, err
	}
	return StatusResult{MarketStatus: e.Value, Freshness: s.freshness(nil, e.StoredAt, stale)}, nil
}

// ErrorCode maps an error to the stable machine-readable code used in API
// responses.
func ErrorCode(err error) string {
	switch {
	case errors.Is(err, ErrInvalidInput):
		return "invalid_request"
	case errors.Is(err, ErrNotFound):
		return "not_found"
	case errors.Is(err, ErrNotConfigured):
		return "provider_not_configured"
	case errors.Is(err, ErrRateLimited):
		return "rate_limited"
	case errors.Is(err, ErrUnauthorized):
		return "provider_auth_failed"
	case errors.Is(err, ErrNotEntitled):
		return "provider_not_entitled"
	case errors.Is(err, context.DeadlineExceeded):
		return "timeout"
	case errors.Is(err, ErrUnavailable):
		return "provider_unavailable"
	default:
		return "internal_error"
	}
}
