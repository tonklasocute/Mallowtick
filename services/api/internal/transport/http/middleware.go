package httptransport

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"io"
	"log/slog"
	"math"
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/tonklasocute/mallowtick/services/api/internal/clientlimit"
	"github.com/tonklasocute/mallowtick/services/api/internal/market"
)

const requestIDHeader = "X-Request-ID"

var requestIDPattern = regexp.MustCompile(`^[A-Za-z0-9\-]{1,64}$`)

func requestID(c *gin.Context) string { return c.GetString("request_id") }

// withRequestID propagates a well-formed incoming request ID or creates one.
func withRequestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.GetHeader(requestIDHeader)
		if !requestIDPattern.MatchString(id) {
			b := make([]byte, 8)
			_, _ = rand.Read(b)
			id = hex.EncodeToString(b)
		}
		c.Set("request_id", id)
		c.Header(requestIDHeader, id)
		c.Next()
	}
}

func withLogging(log *slog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		log.LogAttrs(c.Request.Context(), slog.LevelInfo, "http request",
			slog.String("request_id", requestID(c)),
			slog.String("method", c.Request.Method),
			slog.String("route", c.FullPath()),
			slog.String("path", c.Request.URL.Path),
			slog.Int("status", c.Writer.Status()),
			slog.Duration("duration", time.Since(start)))
	}
}

func withRecovery(log *slog.Logger) gin.HandlerFunc {
	return gin.CustomRecoveryWithWriter(io.Discard, func(c *gin.Context, rec any) {
		log.ErrorContext(c.Request.Context(), "panic recovered",
			slog.String("request_id", requestID(c)), slog.Any("panic", rec))
		writeError(c, http.StatusInternalServerError, "internal_error", "Something went wrong. Please try again.")
	})
}

// withTimeout bounds the handler's context.
func withTimeout(d time.Duration) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), d)
		defer cancel()
		c.Request = c.Request.WithContext(ctx)
		c.Next()
	}
}

// withCORS allows the configured browser origins to read GET responses.
func withCORS(origins []string) gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		c.Header("Vary", "Origin")
		if origin != "" && slices.Contains(origins, origin) {
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Access-Control-Allow-Methods", "GET, OPTIONS")
			c.Header("Access-Control-Allow-Headers", "Content-Type, X-Request-ID")
			c.Header("Access-Control-Expose-Headers", "X-Request-ID, Retry-After")
			c.Header("Access-Control-Max-Age", "600")
		}
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

// withClientLimits caps each client's requests and hands the market service the
// client's share of the vendors' budgets, which only provider calls spend.
// Clients are told apart by the address Gin resolves through the trusted
// proxies: the web app's proxy route forwards X-Forwarded-For.
func withClientLimits(l *clientlimit.Limiter) gin.HandlerFunc {
	return func(c *gin.Context) {
		key := clientlimit.Key(c.ClientIP())
		if allowed, wait := l.Allow(key); !allowed {
			c.Header("Retry-After", strconv.Itoa(max(1, int(math.Ceil(wait.Seconds())))))
			writeError(c, http.StatusTooManyRequests, "too_many_requests", "Too many requests. Please slow down and try again shortly.")
			return
		}
		c.Request = c.Request.WithContext(market.WithAllowance(c.Request.Context(), l.Allowance(key)))
		c.Next()
	}
}

// withNoStore keeps market data out of browser and service-worker caches;
// freshness is managed by the API's own cache and the client's polling.
func withNoStore() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		c.Header("X-Content-Type-Options", "nosniff")
		c.Next()
	}
}
