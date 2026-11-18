package twelvedata

import (
	"context"
	"errors"
	"net/http"
	"sync/atomic"
	"testing"

	"github.com/tonklasocute/mallowtick/services/api/internal/market"
	"github.com/tonklasocute/mallowtick/services/api/internal/resilience"
)

func TestStopsSpendingCreditsOnAFailingVendor(t *testing.T) {
	var hits atomic.Int32
	c := newTestClient(t, map[string]http.HandlerFunc{
		"/market_state": func(w http.ResponseWriter, _ *http.Request) {
			hits.Add(1)
			// Twelve Data reports errors in a 200 body as well.
			_, _ = w.Write([]byte(`{"code":500,"message":"Internal error","status":"error"}`))
		},
	}, 100)
	ctx := context.Background()
	for range breakerThreshold {
		if _, err := c.MarketStatus(ctx); !errors.Is(err, market.ErrUnavailable) {
			t.Fatalf("got %v, want ErrUnavailable", err)
		}
	}
	if _, err := c.MarketStatus(ctx); !errors.Is(err, resilience.ErrOpen) {
		t.Fatalf("an open breaker should fail fast, got %v", err)
	}
	if hits.Load() != breakerThreshold || c.budget.Available() != 100-breakerThreshold {
		t.Fatalf("calls %d, credits left %d: a refused request must cost nothing", hits.Load(), c.budget.Available())
	}
	if s := c.VendorStats(); s.State != resilience.Open || s.LastFailure != "api_500" {
		t.Fatalf("stats = %+v", s)
	}
}
