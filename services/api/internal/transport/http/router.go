// Package httptransport exposes the market service over a versioned JSON API.
// Handlers only parse input, call the service, and shape responses.
package httptransport

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/tonklasocute/mallowtick/services/api/internal/market"
)

// MarketService is the application behaviour the handlers depend on.
type MarketService interface {
	ProviderInfo() market.ProviderInfo
	Search(ctx context.Context, query string) ([]market.Instrument, error)
	Instrument(ctx context.Context, symbol market.Symbol) (market.Instrument, error)
	Quote(ctx context.Context, symbol market.Symbol) (market.QuoteResult, error)
	Quotes(ctx context.Context, symbols []market.Symbol) (market.QuoteBatch, error)
	Candles(ctx context.Context, symbol market.Symbol, rng market.Range) (market.CandlesResult, error)
	Levels(ctx context.Context, symbol market.Symbol, rng market.Range) (market.LevelsResult, error)
	MarketStatus(ctx context.Context) (market.StatusResult, error)
	Overview(ctx context.Context) (market.Overview, error)
	Sectors(ctx context.Context) (market.SectorsResult, error)
	NextEarnings(ctx context.Context, symbol market.Symbol) (market.EarningsResult, error)
	EarningsHistory(ctx context.Context, symbol market.Symbol) (market.EarningsHistoryResult, error)
	Fundamentals(ctx context.Context, symbol market.Symbol) (market.FundamentalsResult, error)
	Recommendations(ctx context.Context, symbol market.Symbol) (market.RecommendationsResult, error)
}

// Options configures the router.
type Options struct {
	Service        MarketService
	Logger         *slog.Logger
	CORSOrigins    []string
	RequestTimeout time.Duration
	Now            func() time.Time
}

type handlers struct {
	svc MarketService
	log *slog.Logger
	now func() time.Time
}

// NewRouter builds the HTTP handler.
func NewRouter(opts Options) http.Handler {
	if opts.Now == nil {
		opts.Now = time.Now
	}
	h := &handlers{svc: opts.Service, log: opts.Logger, now: opts.Now}

	r := gin.New()
	_ = r.SetTrustedProxies(nil)
	r.HandleMethodNotAllowed = true
	r.Use(withRequestID(), withLogging(opts.Logger), withRecovery(opts.Logger), withCORS(opts.CORSOrigins), withNoStore())
	r.NoRoute(func(c *gin.Context) { writeError(c, http.StatusNotFound, "not_found", "Unknown endpoint.") })
	r.NoMethod(func(c *gin.Context) {
		writeError(c, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed.")
	})

	v1 := r.Group("/api/v1", withTimeout(opts.RequestTimeout))
	v1.GET("/health", h.health)
	v1.GET("/market/status", h.marketStatus)
	v1.GET("/market/overview", h.overview)
	v1.GET("/market/sectors", h.sectors)
	v1.GET("/stocks/search", h.search)
	v1.GET("/stocks/quotes", h.quotes)
	v1.GET("/stocks/:symbol", h.instrument)
	v1.GET("/stocks/:symbol/quote", h.quote)
	v1.GET("/stocks/:symbol/candles", h.candles)
	v1.GET("/stocks/:symbol/levels", h.levels)
	v1.GET("/stocks/:symbol/earnings", h.earnings)
	v1.GET("/stocks/:symbol/earnings/history", h.earningsHistory)
	v1.GET("/stocks/:symbol/fundamentals", h.fundamentals)
	v1.GET("/stocks/:symbol/recommendations", h.recommendations)
	return r
}

func (h *handlers) health(c *gin.Context) {
	ok(c, gin.H{"status": "ok", "provider": h.svc.ProviderInfo(), "time": h.now().UTC()})
}

func (h *handlers) marketStatus(c *gin.Context) {
	st, err := h.svc.MarketStatus(c.Request.Context())
	if err != nil {
		fail(c, h.log, err)
		return
	}
	ok(c, st)
}

func (h *handlers) overview(c *gin.Context) {
	ov, err := h.svc.Overview(c.Request.Context())
	if err != nil {
		fail(c, h.log, err)
		return
	}
	ok(c, ov)
}

func (h *handlers) sectors(c *gin.Context) {
	res, err := h.svc.Sectors(c.Request.Context())
	if err != nil {
		fail(c, h.log, err)
		return
	}
	ok(c, res)
}

func (h *handlers) search(c *gin.Context) {
	q, err := market.ParseSearchQuery(c.Query("q"))
	if err != nil {
		fail(c, h.log, err)
		return
	}
	res, err := h.svc.Search(c.Request.Context(), q)
	if err != nil {
		fail(c, h.log, err)
		return
	}
	ok(c, gin.H{"query": q, "results": res})
}

func (h *handlers) quotes(c *gin.Context) {
	syms, err := market.ParseSymbolList(c.Query("symbols"))
	if err != nil {
		fail(c, h.log, err)
		return
	}
	b, err := h.svc.Quotes(c.Request.Context(), syms)
	if err != nil {
		fail(c, h.log, err)
		return
	}
	ok(c, b)
}

// symbolParam parses the :symbol path segment, writing an error on failure.
func (h *handlers) symbolParam(c *gin.Context) (market.Symbol, bool) {
	s, err := market.ParseSymbol(c.Param("symbol"))
	if err != nil {
		fail(c, h.log, err)
		return "", false
	}
	return s, true
}

func (h *handlers) instrument(c *gin.Context) {
	sym, valid := h.symbolParam(c)
	if !valid {
		return
	}
	inst, err := h.svc.Instrument(c.Request.Context(), sym)
	if err != nil {
		fail(c, h.log, err)
		return
	}
	ok(c, inst)
}

func (h *handlers) quote(c *gin.Context) {
	sym, valid := h.symbolParam(c)
	if !valid {
		return
	}
	q, err := h.svc.Quote(c.Request.Context(), sym)
	if err != nil {
		fail(c, h.log, err)
		return
	}
	ok(c, q)
}

func (h *handlers) candles(c *gin.Context) {
	sym, valid := h.symbolParam(c)
	if !valid {
		return
	}
	rng, err := market.ParseRange(c.Query("range"), market.Range1D)
	if err != nil {
		fail(c, h.log, err)
		return
	}
	res, err := h.svc.Candles(c.Request.Context(), sym, rng)
	if err != nil {
		fail(c, h.log, err)
		return
	}
	// Warm-up bars are only for clients that compute indicators; others
	// (e.g. sparklines) get the smaller payload.
	if c.Query("warmup") != "true" {
		res.Warmup = nil
	}
	ok(c, res)
}

func (h *handlers) levels(c *gin.Context) {
	sym, valid := h.symbolParam(c)
	if !valid {
		return
	}
	rng, err := market.ParseRange(c.Query("range"), market.Range3M)
	if err != nil {
		fail(c, h.log, err)
		return
	}
	res, err := h.svc.Levels(c.Request.Context(), sym, rng)
	if err != nil {
		fail(c, h.log, err)
		return
	}
	ok(c, res)
}

func (h *handlers) earnings(c *gin.Context) {
	sym, valid := h.symbolParam(c)
	if !valid {
		return
	}
	res, err := h.svc.NextEarnings(c.Request.Context(), sym)
	if err != nil {
		fail(c, h.log, err)
		return
	}
	ok(c, res)
}

func (h *handlers) fundamentals(c *gin.Context) {
	sym, valid := h.symbolParam(c)
	if !valid {
		return
	}
	res, err := h.svc.Fundamentals(c.Request.Context(), sym)
	if err != nil {
		fail(c, h.log, err)
		return
	}
	ok(c, res)
}

func (h *handlers) earningsHistory(c *gin.Context) {
	sym, valid := h.symbolParam(c)
	if !valid {
		return
	}
	res, err := h.svc.EarningsHistory(c.Request.Context(), sym)
	if err != nil {
		fail(c, h.log, err)
		return
	}
	ok(c, res)
}

func (h *handlers) recommendations(c *gin.Context) {
	sym, valid := h.symbolParam(c)
	if !valid {
		return
	}
	res, err := h.svc.Recommendations(c.Request.Context(), sym)
	if err != nil {
		fail(c, h.log, err)
		return
	}
	ok(c, res)
}
