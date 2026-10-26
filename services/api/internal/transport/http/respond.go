package httptransport

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/tonklasocute/mallowtick/services/api/internal/market"
)

// errorBody is the error envelope: {"error": {...}}.
type errorBody struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	RequestID string `json:"requestId,omitempty"`
}

// ok writes the success envelope: {"data": ...}.
func ok(c *gin.Context, data any) {
	c.JSON(http.StatusOK, gin.H{"data": data})
}

func writeError(c *gin.Context, status int, code, message string) {
	c.AbortWithStatusJSON(status, gin.H{"error": errorBody{Code: code, Message: message, RequestID: requestID(c)}})
}

// fail maps a service error to a status code and a message that is safe to
// show users. Provider details are logged, never returned.
func fail(c *gin.Context, log *slog.Logger, err error) {
	code := market.ErrorCode(err)
	status, message := http.StatusInternalServerError, "Something went wrong. Please try again."
	switch code {
	case "invalid_request":
		status, message = http.StatusBadRequest, strings.TrimPrefix(err.Error(), market.ErrInvalidInput.Error()+": ")
	case "not_found":
		status, message = http.StatusNotFound, "No market data was found for this symbol."
	case "provider_not_configured":
		status, message = http.StatusServiceUnavailable, "Data provider not configured. Set TWELVEDATA_API_KEY on the API server."
	case "rate_limited":
		status, message = http.StatusTooManyRequests, "The market data rate limit was reached. Please try again in a minute."
		c.Header("Retry-After", "60")
	case "provider_auth_failed":
		status, message = http.StatusBadGateway, "The market data provider rejected the server's API key."
	case "provider_not_entitled":
		status, message = http.StatusBadGateway, "The current market data plan does not include this data."
	case "timeout":
		status, message = http.StatusGatewayTimeout, "The market data provider took too long to respond."
	case "provider_unavailable":
		status, message = http.StatusBadGateway, "The market data provider is unavailable right now."
	}

	level := slog.LevelWarn
	if status == http.StatusInternalServerError {
		level = slog.LevelError
	} else if status < http.StatusInternalServerError && !errors.Is(err, market.ErrRateLimited) {
		level = slog.LevelInfo
	}
	log.Log(c.Request.Context(), level, "request failed",
		slog.String("request_id", requestID(c)), slog.String("code", code), slog.Any("error", err))
	writeError(c, status, code, message)
}
