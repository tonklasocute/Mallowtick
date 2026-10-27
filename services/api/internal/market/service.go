package market

import (
	"cmp"
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
	searchTTL     = 24 * time.Hour
	instrumentTTL = 24 * time.Hour
	// statusTTL applies when the provider reports no countdown; otherwise the
	// status is kept until the next open or close, capped at statusMaxTTL.
	statusTTL    = 5 * time.Minute
	statusMaxTTL = 6 * time.Hour
	statusKey    = "status"
	searchLimit  = 10
	// Earnings dates rarely move; a day is plenty of notice either way.
	earningsTTL = 12 * time.Hour
	// The vendor recomputes ratios from the latest close, so a few hours is
	// close enough and costs at most a handful of calls a day per symbol.
	fundamentalsTTL = 6 * time.Hour
	// Analyst rating counts are published monthly.
	ratingsTTL = 12 * time.Hour
	// The portfolio values holdings in baht with this; an hour keeps it to about
	// 24 Twelve Data credits a day.
	fxTTL = time.Hour
)

// Service is the application layer between transports and a Provider.
type Service struct {
	provider Provider
	cfg      ServiceConfig
	log      *slog.Logger
	group    singleflight.Group

	quotes       *cache.TTL[Quote]
	candles      *cache.TTL[CandleSeries]
	searches     *cache.TTL[[]Instrument]
	instruments  *cache.TTL[Instrument]
	status       *cache.TTL[MarketStatus]
	earnings     *cache.TTL[*EarningsEvent]
	surprises    *cache.TTL[[]EarningsSurprise]
	fundamentals *cache.TTL[Fundamentals]
	ratings      *cache.TTL[[]RecommendationTrend]
	// dayChanges and returns hold the sectors' name-free quotes and returns.
	dayChanges *cache.TTL[Quote]
	returns    *cache.TTL[PriceReturns]
	fx         *cache.TTL[ExchangeRate]
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
		provider:     p,
		cfg:          cfg,
		log:          cfg.Logger,
		quotes:       cache.New[Quote](cfg.QuoteTTL, retain, 2000, cfg.Now),
		candles:      cache.New[CandleSeries](time.Minute, retain, 500, cfg.Now),
		searches:     cache.New[[]Instrument](searchTTL, retain, 1000, cfg.Now),
		instruments:  cache.New[Instrument](instrumentTTL, instrumentTTL, 2000, cfg.Now),
		status:       cache.New[MarketStatus](statusTTL, retain, 1, cfg.Now),
		earnings:     cache.New[*EarningsEvent](earningsTTL, retain, 1000, cfg.Now),
		surprises:    cache.New[[]EarningsSurprise](earningsTTL, retain, 1000, cfg.Now),
		fundamentals: cache.New[Fundamentals](fundamentalsTTL, retain, 1000, cfg.Now),
		ratings:      cache.New[[]RecommendationTrend](ratingsTTL, retain, 1000, cfg.Now),
		dayChanges:   cache.New[Quote](cfg.QuoteTTL, retain, 100, cfg.Now),
		returns:      cache.New[PriceReturns](fundamentalsTTL, retain, 100, cfg.Now),
		fx:           cache.New[ExchangeRate](fxTTL, retain, 10, cfg.Now),
	}
}

// source is the vendor behind a kind of data.
func (s *Service) source(kind DataKind) Provider {
	if m, ok := s.provider.(MultiSource); ok {
		return m.SourceFor(kind)
	}
	return s.provider
}

// SourceInfo names the vendor behind one kind of data.
type SourceInfo struct {
	Name       string `json:"name"`
	Configured bool   `json:"configured"`
}

// ProviderInfo describes the configured provider and, per kind of data, the
// vendor that supplies it.
type ProviderInfo struct {
	Name       string                  `json:"name"`
	Configured bool                    `json:"configured"`
	Latency    Latency                 `json:"latency"`
	Sources    map[DataKind]SourceInfo `json:"sources"`
}

func (s *Service) ProviderInfo() ProviderInfo {
	info := ProviderInfo{
		Name: s.provider.Name(), Configured: s.provider.Configured(), Latency: s.cfg.Latency,
		Sources: make(map[DataKind]SourceInfo, len(DataKinds)),
	}
	for _, kind := range DataKinds {
		p := s.source(kind)
		if !serves(p, kind) {
			continue // no vendor publishes this kind of data in this deployment
		}
		info.Sources[kind] = SourceInfo{Name: p.Name(), Configured: p.Configured()}
	}
	return info
}

// serves reports whether p can supply kind; earnings and fundamentals need an
// optional interface that not every vendor implements.
func serves(p Provider, kind DataKind) bool {
	switch kind {
	case KindEarnings:
		_, ok := p.(EarningsProvider)
		return ok
	case KindFundamentals:
		_, ok := p.(FundamentalsProvider)
		return ok
	case KindFX:
		_, ok := p.(FXProvider)
		return ok
	}
	return true
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

// CandlesResult is a candle series for a UI range. Candles holds the range's
// bars; Warmup holds up to WarmupBars earlier bars for indicator calculation.
type CandlesResult struct {
	CandleSeries
	Warmup    []Candle  `json:"warmup,omitempty"`
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

const levelsDisclaimer = "แนวรับ-แนวต้านคำนวณโดย Mallowtick จากแท่งเทียนย้อนหลัง เป็นค่าประมาณเชิงวิเคราะห์ ไม่ใช่ข้อมูลจากผู้ให้บริการ และไม่ได้คาดการณ์ราคาในอนาคต"

func (s *Service) freshness(kind DataKind, asOf *time.Time, fetchedAt time.Time, stale bool) Freshness {
	return Freshness{Provider: s.source(kind).Name(), Latency: s.cfg.Latency, AsOf: asOf, FetchedAt: fetchedAt.UTC(), Stale: stale}
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

// closedFor reports how long the market stays closed, judged only from the
// cached market status so it never spends provider credits. ok is false while
// the market is open or the next open is unknown.
func (s *Service) closedFor() (time.Duration, bool) {
	e, state := s.status.Get(statusKey)
	if state != cache.Fresh || e.Value.IsOpen || e.Value.OpensInSeconds == nil {
		return 0, false
	}
	left := time.Duration(*e.Value.OpensInSeconds)*time.Second - s.cfg.Now().Sub(e.StoredAt)
	return left, left > 0
}

// quoteTTL keeps closed-market quotes until the next open: prices do not move
// in between, so refetching them only spends credits.
func (s *Service) quoteTTL(q Quote) time.Duration {
	if q.IsMarketOpen != nil && !*q.IsMarketOpen {
		if d, ok := s.closedFor(); ok {
			return d
		}
		if s.cfg.QuoteTTLClosed > 0 {
			return s.cfg.QuoteTTLClosed
		}
	}
	return s.cfg.QuoteTTL
}

// candleTTL applies the range's TTL, or keeps the series until the next open
// when the market is closed and no new bars can form.
func (s *Service) candleTTL(spec RangeSpec) func(CandleSeries) time.Duration {
	return func(CandleSeries) time.Duration {
		if d, ok := s.closedFor(); ok && d > spec.CacheTTL {
			return d
		}
		return spec.CacheTTL
	}
}

// statusTTLFor keeps the status until the provider-reported next open or
// close, so it is fetched about twice a day instead of every few minutes.
func statusTTLFor(st MarketStatus) time.Duration {
	countdown := st.OpensInSeconds
	if st.IsOpen {
		countdown = st.ClosesInSeconds
	}
	if countdown == nil || *countdown <= 0 {
		return statusTTL
	}
	return min(time.Duration(*countdown)*time.Second, statusMaxTTL)
}

// quoteFetch is one provider batch: the quotes it stored and, for a partial
// result, why the rest are missing.
type quoteFetch struct {
	stored     map[Symbol]cache.Entry[Quote]
	missingErr error
}

// resolveQuotes resolves each symbol from cache or one provider request for all
// misses. It returns per-symbol errors for symbols it could not resolve.
func (s *Service) resolveQuotes(ctx context.Context, symbols []Symbol) ([]QuoteResult, map[Symbol]error) {
	return s.resolveQuotesFrom(ctx, symbols, s.quotes, "quotes:", s.provider.Quotes)
}

// resolveQuotesFrom is resolveQuotes over another cache and fetch, e.g. quotes
// without names, which must not land in the main quote cache.
func (s *Service) resolveQuotesFrom(ctx context.Context, symbols []Symbol, quotes *cache.TTL[Quote], keyPrefix string,
	fetch func(context.Context, []Symbol) (map[Symbol]Quote, error)) ([]QuoteResult, map[Symbol]error) {
	results := make(map[Symbol]QuoteResult, len(symbols))
	staleEntries := make(map[Symbol]cache.Entry[Quote])
	var misses []Symbol
	for _, sym := range symbols {
		e, st := quotes.Get(string(sym))
		switch st {
		case cache.Fresh:
			results[sym] = QuoteResult{Quote: e.Value, Freshness: s.freshness(KindQuotes, e.Value.AsOf, e.StoredAt, false)}
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
		v, fetchErr := s.do(ctx, keyPrefix+strings.Join(keys, ","), func(fctx context.Context) (any, error) {
			got, err := fetch(fctx, misses)
			if err != nil && len(got) == 0 {
				return nil, err
			}
			f := quoteFetch{stored: make(map[Symbol]cache.Entry[Quote], len(got)), missingErr: err}
			for sym, q := range got {
				if q.IsMarketOpen == nil {
					// Some vendors' quotes omit market state; take it from the status
					// already cached (never fetched for this) so labels and TTLs know.
					q.IsMarketOpen = s.cachedMarketOpen()
				}
				f.stored[sym] = quotes.SetWithTTL(string(sym), q, s.quoteTTL(q))
			}
			return f, nil
		})
		var fetched quoteFetch
		if fetchErr == nil {
			fetched = v.(quoteFetch)
		}
		for _, sym := range misses {
			if e, ok := fetched.stored[sym]; ok {
				results[sym] = QuoteResult{Quote: e.Value, Freshness: s.freshness(KindQuotes, e.Value.AsOf, e.StoredAt, false)}
				continue
			}
			err := cmp.Or(fetchErr, fetched.missingErr, ErrNotFound)
			if e, ok := staleEntries[sym]; ok && canFallBack(err) {
				s.log.WarnContext(ctx, "serving stale quote", slog.String("symbol", string(sym)), slog.Any("error", err))
				results[sym] = QuoteResult{Quote: e.Value, Freshness: s.freshness(KindQuotes, e.Value.AsOf, e.StoredAt, true)}
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
	q := got[0]
	if q.Volume == nil {
		q.Volume = s.sessionVolume(symbol, q.AsOf)
	}
	if q.FiftyTwoWeek == nil {
		if rp, ok := s.source(KindQuotes).(RangeProvider); ok {
			// Optional extra: a failure leaves the range unknown, not the quote.
			if r, err := rp.FiftyTwoWeek(ctx, symbol); err == nil {
				q.FiftyTwoWeek = r
			}
		}
	}
	return q, nil
}

// cachedMarketOpen is the market state from the cached status, or nil when
// none is cached. It never calls the provider.
func (s *Service) cachedMarketOpen() *bool {
	e, state := s.status.Get(statusKey)
	if state != cache.Fresh {
		return nil
	}
	open := e.Value.IsOpen
	return &open
}

// sessionVolume fills in the session's volume for vendors whose quotes lack
// it, from the session's daily bar already cached for the chart, once the
// market has closed and the bar is final. It never fetches. Intraday bars are
// not summed: on Twelve Data's free plan their volumes cover only part of the
// market (AAPL's first 5-minute bar showed ~50k shares), so the total would be
// far too low. During the session the volume therefore stays unknown.
func (s *Service) sessionVolume(symbol Symbol, asOf *time.Time) *int64 {
	if asOf == nil {
		return nil
	}
	if _, closed := s.closedFor(); !closed {
		return nil
	}
	for _, rng := range []Range{Range1M, Range3M, Range1Y} {
		if e, state := s.candles.Get(candleKey(symbol, rng)); state == cache.Fresh {
			if v := dailyVolumeOn(e.Value, *asOf); v != nil {
				return v
			}
		}
	}
	return nil
}

// dailyVolumeOn returns the last daily bar's volume when that bar is asOf's
// session date in the exchange's time zone.
func dailyVolumeOn(series CandleSeries, asOf time.Time) *int64 {
	last := len(series.Candles) - 1
	if last < 0 || series.Interval != Interval1Day {
		return nil
	}
	loc, err := time.LoadLocation(series.ExchangeTimezone)
	if err != nil {
		loc, _ = time.LoadLocation("America/New_York")
	}
	bar := series.Candles[last]
	if bar.Time.In(loc).Format(time.DateOnly) != asOf.In(loc).Format(time.DateOnly) {
		return nil
	}
	return bar.Volume
}

// EarningsResult is the next scheduled earnings report for a symbol; Next is
// nil when none is scheduled within the vendor's calendar.
type EarningsResult struct {
	Symbol    Symbol         `json:"symbol"`
	Next      *EarningsEvent `json:"next"`
	Freshness Freshness      `json:"freshness"`
}

// NextEarnings returns the next earnings report. It fails with
// ErrNotConfigured when no configured vendor publishes an earnings calendar.
func (s *Service) NextEarnings(ctx context.Context, symbol Symbol) (EarningsResult, error) {
	ep, ok := s.source(KindEarnings).(EarningsProvider)
	if !ok {
		return EarningsResult{}, ErrNotConfigured
	}
	e, stale, err := load(ctx, s, s.earnings, "earnings:"+string(symbol), fixedTTL[*EarningsEvent](earningsTTL),
		func(fctx context.Context) (*EarningsEvent, error) { return ep.NextEarnings(fctx, symbol, s.cfg.Now()) })
	if err != nil {
		return EarningsResult{}, err
	}
	return EarningsResult{Symbol: symbol, Next: e.Value, Freshness: s.freshness(KindEarnings, nil, e.StoredAt, stale)}, nil
}

// EarningsHistoryResult is the latest reported quarters, newest first.
type EarningsHistoryResult struct {
	Symbol    Symbol             `json:"symbol"`
	Quarters  []EarningsSurprise `json:"quarters"`
	Freshness Freshness          `json:"freshness"`
}

// EarningsHistory returns reported EPS against estimates for the latest
// quarters. It fails with ErrNotConfigured like NextEarnings.
func (s *Service) EarningsHistory(ctx context.Context, symbol Symbol) (EarningsHistoryResult, error) {
	ep, ok := s.source(KindEarnings).(EarningsProvider)
	if !ok {
		return EarningsHistoryResult{}, ErrNotConfigured
	}
	e, stale, err := load(ctx, s, s.surprises, "surprises:"+string(symbol), fixedTTL[[]EarningsSurprise](earningsTTL),
		func(fctx context.Context) ([]EarningsSurprise, error) { return ep.EarningsHistory(fctx, symbol) })
	if err != nil {
		return EarningsHistoryResult{}, err
	}
	return EarningsHistoryResult{
		Symbol: symbol, Quarters: nonNil(e.Value), Freshness: s.freshness(KindEarnings, nil, e.StoredAt, stale),
	}, nil
}

// RecommendationsResult is the monthly analyst rating counts, newest first.
type RecommendationsResult struct {
	Symbol    Symbol                `json:"symbol"`
	Trends    []RecommendationTrend `json:"trends"`
	Freshness Freshness             `json:"freshness"`
}

// Recommendations returns analyst rating counts. It fails with
// ErrNotConfigured like Fundamentals.
func (s *Service) Recommendations(ctx context.Context, symbol Symbol) (RecommendationsResult, error) {
	fp, ok := s.source(KindFundamentals).(FundamentalsProvider)
	if !ok {
		return RecommendationsResult{}, ErrNotConfigured
	}
	e, stale, err := load(ctx, s, s.ratings, "ratings:"+string(symbol), fixedTTL[[]RecommendationTrend](ratingsTTL),
		func(fctx context.Context) ([]RecommendationTrend, error) { return fp.Recommendations(fctx, symbol) })
	if err != nil {
		return RecommendationsResult{}, err
	}
	return RecommendationsResult{
		Symbol: symbol, Trends: nonNil(e.Value), Freshness: s.freshness(KindFundamentals, nil, e.StoredAt, stale),
	}, nil
}

// nonNil turns a nil slice into an empty one so it encodes as [] not null.
func nonNil[T any](v []T) []T {
	if v == nil {
		return []T{}
	}
	return v
}

// ExchangeRateResult is an exchange rate with freshness metadata.
type ExchangeRateResult struct {
	ExchangeRate
	Freshness Freshness `json:"freshness"`
}

// ExchangeRate returns how many baht one US dollar costs. It fails with
// ErrNotConfigured when no configured vendor publishes exchange rates.
func (s *Service) ExchangeRate(ctx context.Context) (ExchangeRateResult, error) {
	fp, ok := s.source(KindFX).(FXProvider)
	if !ok {
		return ExchangeRateResult{}, ErrNotConfigured
	}
	e, stale, err := load(ctx, s, s.fx, "fx:USD/THB", fixedTTL[ExchangeRate](fxTTL),
		func(fctx context.Context) (ExchangeRate, error) { return fp.ExchangeRate(fctx, "USD", "THB") })
	if err != nil {
		return ExchangeRateResult{}, err
	}
	return ExchangeRateResult{ExchangeRate: e.Value, Freshness: s.freshness(KindFX, e.Value.AsOf, e.StoredAt, stale)}, nil
}

// FundamentalsResult is a company profile and its key metrics.
type FundamentalsResult struct {
	Fundamentals
	Freshness Freshness `json:"freshness"`
}

// Fundamentals returns the company profile and key metrics. It fails with
// ErrNotConfigured when no configured vendor publishes them.
func (s *Service) Fundamentals(ctx context.Context, symbol Symbol) (FundamentalsResult, error) {
	fp, ok := s.source(KindFundamentals).(FundamentalsProvider)
	if !ok {
		return FundamentalsResult{}, ErrNotConfigured
	}
	e, stale, err := load(ctx, s, s.fundamentals, "fundamentals:"+string(symbol), fixedTTL[Fundamentals](fundamentalsTTL),
		func(fctx context.Context) (Fundamentals, error) { return fp.Fundamentals(fctx, symbol) })
	if err != nil {
		return FundamentalsResult{}, err
	}
	return FundamentalsResult{Fundamentals: e.Value, Freshness: s.freshness(KindFundamentals, nil, e.StoredAt, stale)}, nil
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

func candleKey(symbol Symbol, rng Range) string {
	return "candles:" + string(symbol) + ":" + string(rng)
}

// Candles returns the bars covering a UI range.
func (s *Service) Candles(ctx context.Context, symbol Symbol, rng Range) (CandlesResult, error) {
	spec := rng.Spec()
	e, stale, err := load(ctx, s, s.candles, candleKey(symbol, rng), s.candleTTL(spec), func(fctx context.Context) (CandleSeries, error) {
		return s.provider.Candles(fctx, symbol, spec.Interval, spec.Bars+WarmupBars)
	})
	if err != nil {
		return CandlesResult{}, err
	}
	series := e.Value
	split := max(len(series.Candles)-spec.Bars, 0)
	visible, warmup := series.Candles[split:], series.Candles[:split]
	series.Candles = visible
	var asOf *time.Time
	if n := len(visible); n > 0 {
		t := visible[n-1].Time
		asOf = &t
	}
	return CandlesResult{CandleSeries: series, Warmup: warmup, Range: rng, Freshness: s.freshness(KindCandles, asOf, e.StoredAt, stale)}, nil
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

// MarketStatus reports whether the US equity market is open. Countdowns are
// recomputed from the cached value's age, since the status is kept for hours.
func (s *Service) MarketStatus(ctx context.Context) (StatusResult, error) {
	e, stale, err := load(ctx, s, s.status, statusKey, statusTTLFor, s.provider.MarketStatus)
	if err != nil {
		return StatusResult{}, err
	}
	st := e.Value
	elapsed := int64(s.cfg.Now().Sub(e.StoredAt) / time.Second)
	st.OpensInSeconds = remaining(st.OpensInSeconds, elapsed)
	st.ClosesInSeconds = remaining(st.ClosesInSeconds, elapsed)
	return StatusResult{MarketStatus: st, Freshness: s.freshness(KindStatus, nil, e.StoredAt, stale)}, nil
}

// remaining shortens a countdown by elapsed seconds; nil once it has run out.
func remaining(countdown *int64, elapsed int64) *int64 {
	if countdown == nil || *countdown-elapsed <= 0 {
		return nil
	}
	left := *countdown - elapsed
	return &left
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
