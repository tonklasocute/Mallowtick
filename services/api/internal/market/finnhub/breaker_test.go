package finnhub

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/tonklasocute/mallowtick/services/api/internal/market"
	"github.com/tonklasocute/mallowtick/services/api/internal/resilience"
)

func TestStopsCallingFinnhubAfterRepeatedFailures(t *testing.T) {
	var hits atomic.Int32
	c := newTestClient(t, map[string]http.HandlerFunc{
		"/stock/recommendation": func(w http.ResponseWriter, _ *http.Request) {
			hits.Add(1)
			w.WriteHeader(http.StatusBadGateway)
		},
	}, 60)
	ctx := context.Background()
	for range breakerThreshold {
		if _, err := c.Recommendations(ctx, "AAPL"); !errors.Is(err, market.ErrUnavailable) {
			t.Fatalf("got %v, want ErrUnavailable", err)
		}
	}
	_, err := c.Recommendations(ctx, "AAPL")
	if !errors.Is(err, market.ErrUnavailable) || !errors.Is(err, resilience.ErrOpen) {
		t.Fatalf("an open breaker should fail fast with ErrUnavailable, got %v", err)
	}
	if n := hits.Load(); n != breakerThreshold {
		t.Fatalf("Finnhub was called %d times, want %d", n, breakerThreshold)
	}
	if avail := c.budget.Available(); avail != 60-breakerThreshold {
		t.Fatalf("a refused call must not book budget: %d free", avail)
	}
	if s := c.VendorStats(); s.State != resilience.Open || s.LastFailure != "http_502" || s.Failures != breakerThreshold {
		t.Fatalf("stats = %+v", s)
	}
}

func TestRefusalsDoNotOpenTheBreaker(t *testing.T) {
	c := newTestClient(t, map[string]http.HandlerFunc{
		"/stock/recommendation": status(http.StatusForbidden, `{"error":"You don't have access to this resource."}`),
	}, 60)
	for range breakerThreshold + 2 {
		if _, err := c.Recommendations(context.Background(), "AAPL"); !errors.Is(err, market.ErrNotEntitled) {
			t.Fatalf("got %v, want ErrNotEntitled", err)
		}
	}
	if s := c.VendorStats(); s.State != resilience.Closed || s.Failures != 0 {
		t.Fatalf("a vendor that answers is up: %+v", s)
	}
}

func TestOnlyTheProbeBooksBudgetAfterTheCooldown(t *testing.T) {
	var hits atomic.Int32
	var failing atomic.Bool
	failing.Store(true)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		if failing.Load() {
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		time.Sleep(50 * time.Millisecond) // the probe is still out when the others arrive
		_, _ = w.Write([]byte(`[]`))
	}))
	t.Cleanup(srv.Close)
	var mu sync.Mutex
	clock := time.Unix(0, 0)
	now := func() time.Time { mu.Lock(); defer mu.Unlock(); return clock }
	c, err := New(Config{APIKey: testKey, BaseURL: srv.URL, CallsPerMinute: 60, MaxWait: 20 * time.Millisecond, Now: now})
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	for range breakerThreshold {
		_, _ = c.Recommendations(ctx, "AAPL")
	}
	failing.Store(false)
	mu.Lock()
	clock = clock.Add(breakerCooldown)
	mu.Unlock()
	before := c.budget.Available()

	var wg sync.WaitGroup
	for range 5 {
		wg.Go(func() { _, _ = c.Recommendations(ctx, "AAPL") })
	}
	wg.Wait()
	if got := hits.Load(); got != breakerThreshold+1 {
		t.Fatalf("Finnhub was called %d times, want the %d failures and one probe", got, breakerThreshold)
	}
	if spent := before - c.budget.Available(); spent != 1 {
		t.Fatalf("%d calls were booked, want only the probe's", spent)
	}
	if s := c.VendorStats(); s.State != resilience.Closed {
		t.Fatalf("a successful probe closes the breaker: %+v", s)
	}
}
