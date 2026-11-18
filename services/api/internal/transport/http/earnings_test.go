package httptransport

import (
	"net/http"
	"strings"
	"testing"
)

func TestEarningsRoutes(t *testing.T) {
	svc := &stubService{}
	rec, _ := do(t, svc, http.MethodGet, "/api/v1/earnings/calendar?symbols=aapl,MSFT", nil)
	if rec.Code != http.StatusOK || len(svc.lastBatch) != 2 || svc.lastBatch[0] != "AAPL" {
		t.Fatalf("calendar: %d %s, symbols %v", rec.Code, rec.Body, svc.lastBatch)
	}
	if !strings.Contains(rec.Body.String(), `"from":"2026-11-18","to":"2026-12-01"`) {
		t.Fatalf("default range should be today and the next 13 days: %s", rec.Body)
	}
	rec, _ = do(t, svc, http.MethodGet, "/api/v1/earnings/nvda", nil)
	if rec.Code != http.StatusOK || svc.lastSymbol != "NVDA" {
		t.Fatalf("symbol earnings: %d, symbol %q", rec.Code, svc.lastSymbol)
	}
	rec, _ = do(t, svc, http.MethodGet, "/api/v1/earnings/brk.b/history", nil)
	if rec.Code != http.StatusOK || svc.lastSymbol != "BRK.B" {
		t.Fatalf("history: %d, symbol %q", rec.Code, svc.lastSymbol)
	}
}

func TestEarningsCalendarValidation(t *testing.T) {
	many := strings.Repeat("AAPL,", 51)
	for _, target := range []string{
		"/api/v1/earnings/calendar?from=18-11-2026",
		"/api/v1/earnings/calendar?from=2026-11-20&to=2026-11-19",
		"/api/v1/earnings/calendar?from=2026-11-01&to=2026-12-31",
		"/api/v1/earnings/calendar?from=2025-01-01&to=2025-01-07",
		"/api/v1/earnings/calendar?symbols=" + many + "TOOLONGSYM",
		"/api/v1/earnings/calendar?symbols=$$$",
		"/api/v1/earnings/not!a!ticker",
	} {
		rec, env := do(t, &stubService{}, http.MethodGet, target, nil)
		if rec.Code != http.StatusBadRequest || env.Error == nil || env.Error.Code != "invalid_request" {
			t.Errorf("%s: %d %s", target, rec.Code, rec.Body)
		}
	}
}
