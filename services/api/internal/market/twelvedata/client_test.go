package twelvedata

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/tonklasocute/mallowtick/services/api/internal/market"
)

const testKey = "test-key"

// newTestClient starts a server that checks auth and routes by path.
func newTestClient(t *testing.T, routes map[string]http.HandlerFunc, credits int) *Client {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "apikey "+testKey {
			t.Errorf("Authorization header = %q", got)
		}
		if r.URL.Query().Has("apikey") {
			t.Error("API key must not be sent in the query string")
		}
		h, ok := routes[r.URL.Path]
		if !ok {
			t.Errorf("unexpected path %s", r.URL.Path)
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		h(w, r)
	}))
	t.Cleanup(srv.Close)
	c, err := New(Config{APIKey: testKey, BaseURL: srv.URL, CreditsPerMinute: credits, MaxWait: 50 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	// A fixed mid-minute clock keeps budget tests independent of when they run.
	c.budget.now = fixedClock(time.Date(2026, 10, 26, 12, 27, 30, 0, time.UTC))
	return c
}

func fixedClock(t time.Time) func() time.Time { return func() time.Time { return t } }

func respond(body string) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(body)) }
}

func TestNewValidatesConfig(t *testing.T) {
	for name, cfg := range map[string]Config{
		"missing key":     {BaseURL: "https://api.twelvedata.com", CreditsPerMinute: 8},
		"bad base url":    {APIKey: "k", BaseURL: "not a url", CreditsPerMinute: 8},
		"invalid credits": {APIKey: "k", BaseURL: "https://api.twelvedata.com"},
	} {
		if _, err := New(cfg); err == nil {
			t.Errorf("%s: expected error", name)
		}
	}
}

func TestQuoteSingle(t *testing.T) {
	c := newTestClient(t, map[string]http.HandlerFunc{
		"/quote": func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Query().Get("symbol") != "AAPL" {
				t.Errorf("symbol = %q", r.URL.Query().Get("symbol"))
			}
			_, _ = w.Write([]byte(`{"symbol":"AAPL","name":"Apple Inc.","exchange":"NASDAQ","currency":"USD",
				"datetime":"2026-10-23","timestamp":1761192000,"last_quote_at":1761249600,
				"open":"187.42","high":"189.76","low":"186.90","close":"189.32","volume":"52400000",
				"previous_close":"187.46","change":"1.86","percent_change":"0.99","is_market_open":false,
				"fifty_two_week":{"low":"164.08","high":"199.62"}}`))
		},
	}, 8)

	got, err := c.Quotes(context.Background(), []market.Symbol{"AAPL"})
	if err != nil {
		t.Fatal(err)
	}
	q := got["AAPL"]
	if q.Price != 189.32 || *q.Change != 1.86 || *q.ChangePercent != 0.99 || *q.Volume != 52400000 {
		t.Fatalf("unexpected quote %+v", q)
	}
	if q.AsOf == nil || !q.AsOf.Equal(time.Unix(1761249600, 0)) {
		t.Fatalf("asOf should come from last_quote_at, got %v", q.AsOf)
	}
	if q.IsMarketOpen == nil || *q.IsMarketOpen || q.FiftyTwoWeek == nil || q.FiftyTwoWeek.High != 199.62 {
		t.Fatalf("unexpected market-open / 52w fields: %+v", q)
	}
}

func TestQuoteWithoutLastQuoteAtHasNoAsOf(t *testing.T) {
	c := newTestClient(t, map[string]http.HandlerFunc{
		"/quote": respond(`{"symbol":"AAPL","name":"Apple Inc.","close":"189.32","timestamp":1761192000}`),
	}, 8)
	got, err := c.Quotes(context.Background(), []market.Symbol{"AAPL"})
	if err != nil {
		t.Fatal(err)
	}
	if got["AAPL"].AsOf != nil || got["AAPL"].Change != nil {
		t.Fatalf("unreported fields must stay nil: %+v", got["AAPL"])
	}
}

func TestQuoteBatchSkipsPerSymbolErrors(t *testing.T) {
	c := newTestClient(t, map[string]http.HandlerFunc{
		"/quote": respond(`{
			"AAPL":{"symbol":"AAPL","name":"Apple Inc.","close":"189.32"},
			"ZZZZ":{"code":404,"message":"symbol not found","status":"error"}}`),
	}, 8)
	got, err := c.Quotes(context.Background(), []market.Symbol{"AAPL", "ZZZZ"})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got["AAPL"].Price != 189.32 {
		t.Fatalf("got %+v", got)
	}
}

func TestErrorMapping(t *testing.T) {
	cases := []struct {
		body string
		want error
	}{
		{`{"code":401,"message":"invalid api key","status":"error"}`, market.ErrUnauthorized},
		{`{"code":403,"message":"upgrade your plan","status":"error"}`, market.ErrNotEntitled},
		{`{"code":404,"message":"not found","status":"error"}`, market.ErrNotFound},
		{`{"code":400,"message":"**symbol** not found: ZZZZ","status":"error"}`, market.ErrNotFound},
		{`{"code":429,"message":"You have run out of API credits for the current minute","status":"error"}`, market.ErrRateLimited},
		{`{"code":500,"message":"internal error","status":"error"}`, market.ErrUnavailable},
		{`not json`, market.ErrUnavailable},
	}
	for _, tc := range cases {
		c := newTestClient(t, map[string]http.HandlerFunc{"/quote": respond(tc.body)}, 8)
		_, err := c.Quotes(context.Background(), []market.Symbol{"ZZZZ"})
		if !errors.Is(err, tc.want) {
			t.Errorf("body %s: got %v, want %v", tc.body, err, tc.want)
		}
	}
}

func TestHTTPStatusWithoutEnvelope(t *testing.T) {
	c := newTestClient(t, map[string]http.HandlerFunc{
		"/quote": func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusBadGateway) },
	}, 8)
	_, err := c.Quotes(context.Background(), []market.Symbol{"AAPL"})
	if !errors.Is(err, market.ErrUnavailable) {
		t.Fatalf("got %v", err)
	}
}

func TestLocalRateLimitFailsFast(t *testing.T) {
	var calls atomic.Int32
	c := newTestClient(t, map[string]http.HandlerFunc{
		"/quote": func(w http.ResponseWriter, _ *http.Request) {
			calls.Add(1)
			_, _ = w.Write([]byte(`{"symbol":"AAPL","close":"1"}`))
		},
	}, 1)
	ctx := context.Background()
	if _, err := c.Quotes(ctx, []market.Symbol{"AAPL"}); err != nil {
		t.Fatal(err)
	}
	_, err := c.Quotes(ctx, []market.Symbol{"AAPL"})
	if !errors.Is(err, market.ErrRateLimited) {
		t.Fatalf("second call: got %v, want ErrRateLimited", err)
	}
	if calls.Load() != 1 {
		t.Fatalf("rate-limited call must not reach the provider; calls = %d", calls.Load())
	}
}

func TestProviderRateLimitStopsRequestsForTheMinute(t *testing.T) {
	var calls atomic.Int32
	c := newTestClient(t, map[string]http.HandlerFunc{
		"/quote": func(w http.ResponseWriter, _ *http.Request) {
			calls.Add(1)
			_, _ = w.Write([]byte(`{"code":429,"message":"You have run out of API credits for the current minute","status":"error"}`))
		},
	}, 8)
	ctx := context.Background()
	if _, err := c.Quotes(ctx, []market.Symbol{"AAPL"}); !errors.Is(err, market.ErrRateLimited) {
		t.Fatalf("got %v, want ErrRateLimited", err)
	}
	if _, err := c.Quotes(ctx, []market.Symbol{"AAPL"}); !errors.Is(err, market.ErrRateLimited) {
		t.Fatalf("got %v, want ErrRateLimited", err)
	}
	if calls.Load() != 1 {
		t.Fatalf("after a provider 429 no request should be sent until the minute ends; calls = %d", calls.Load())
	}
}

// clock is a settable time source for budget tests.
type clock struct{ t time.Time }

func (c *clock) now() time.Time { return c.t }

func TestBudgetCountsASlidingMinute(t *testing.T) {
	// The sequence the provider rejected: 1 credit at :43, 7 at :54, then 1 at
	// :01 of the next minute, still within 60 seconds of the first.
	clk := &clock{t: time.Date(2026, 10, 26, 12, 30, 43, 0, time.UTC)}
	b := newCreditBudget(8)
	b.now = clk.now
	b.reserve(1, 0)
	clk.t = clk.t.Add(11 * time.Second)
	if e, _ := b.reserve(7, 0); e == nil {
		t.Fatal("7 credits should fit beside the first one")
	}

	clk.t = clk.t.Add(7 * time.Second)
	if e, wait := b.reserve(1, 10*time.Second); e != nil {
		t.Fatalf("a 9th credit within 60s must not be booked (wait %s)", wait)
	}
	// It becomes available once the :43 credit is a minute old (plus margin).
	wantWait := 60*time.Second + windowMargin - 18*time.Second
	if e, wait := b.reserve(1, time.Minute); e == nil || wait != wantWait {
		t.Fatalf("got wait %s, want %s", wait, wantWait)
	}
}

func TestBudgetReleaseAndExhaust(t *testing.T) {
	clk := &clock{t: time.Date(2026, 10, 26, 12, 0, 0, 0, time.UTC)}
	b := newCreditBudget(8)
	b.now = clk.now
	e, _ := b.reserve(8, 0)
	b.release(e)
	if e, _ := b.reserve(8, 0); e == nil {
		t.Fatal("released credits should be bookable again")
	}

	clk.t = clk.t.Add(2 * time.Minute)
	b.exhaust()
	if e, _ := b.reserve(1, 30*time.Second); e != nil {
		t.Fatal("after exhaust no credit should be available within the window")
	}
}

func TestBatchLargerThanAllowanceReturnsPartial(t *testing.T) {
	c := newTestClient(t, map[string]http.HandlerFunc{
		"/quote": func(w http.ResponseWriter, r *http.Request) {
			syms := strings.Split(r.URL.Query().Get("symbol"), ",")
			if len(syms) > 2 {
				t.Errorf("chunk of %d exceeds the 2-credit allowance", len(syms))
			}
			_, _ = w.Write([]byte(`{"AAA":{"symbol":"AAA","close":"1"},"BBB":{"symbol":"BBB","close":"2"}}`))
		},
	}, 2)
	got, err := c.Quotes(context.Background(), []market.Symbol{"AAA", "BBB", "CCC"})
	if !errors.Is(err, market.ErrRateLimited) {
		t.Fatalf("the symbol left over should be reported as rate limited, got %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("got %d quotes, want the 2 that fit", len(got))
	}
}

func TestBatchUsesOnlyTheCreditsLeft(t *testing.T) {
	var sizes []int
	c := newTestClient(t, map[string]http.HandlerFunc{
		"/quote": func(w http.ResponseWriter, r *http.Request) {
			syms := strings.Split(r.URL.Query().Get("symbol"), ",")
			sizes = append(sizes, len(syms))
			body := `{`
			for i, s := range syms {
				if i > 0 {
					body += ","
				}
				body += `"` + s + `":{"symbol":"` + s + `","close":"1"}`
			}
			_, _ = w.Write([]byte(body + `}`))
		},
		"/market_state": respond(`[{"name":"NYSE","code":"XNYS","is_market_open":false,"time_to_open":"10:00:00"}]`),
	}, 8)
	ctx := context.Background()
	if _, err := c.MarketStatus(ctx); err != nil { // 1 credit, 7 left
		t.Fatal(err)
	}
	got, err := c.Quotes(ctx, []market.Symbol{"S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"})
	if !errors.Is(err, market.ErrRateLimited) || len(got) != 7 {
		t.Fatalf("want the first 7 symbols and ErrRateLimited for the 8th; got %d quotes, err %v", len(got), err)
	}
	if len(sizes) != 1 || sizes[0] != 7 {
		t.Fatalf("one request sized to the free credits expected, got %v", sizes)
	}
}

func TestCandles(t *testing.T) {
	c := newTestClient(t, map[string]http.HandlerFunc{
		"/time_series": func(w http.ResponseWriter, r *http.Request) {
			q := r.URL.Query()
			if q.Get("interval") != "5min" || q.Get("outputsize") != "78" || q.Get("order") != "asc" {
				t.Errorf("unexpected params %v", q)
			}
			_, _ = w.Write([]byte(`{"meta":{"symbol":"AAPL","interval":"5min","currency":"USD","exchange_timezone":"America/New_York"},
				"values":[
					{"datetime":"2026-10-23 09:30:00","open":"187.4","high":"188","low":"187","close":"187.9","volume":"1200"},
					{"datetime":"bad","open":"1","high":"1","low":"1","close":"1"},
					{"datetime":"2026-10-23 09:35:00","open":"187.9","high":"188.5","low":"187.8","close":"188.2","volume":""}
				],"status":"ok"}`))
		},
	}, 8)
	s, err := c.Candles(context.Background(), "AAPL", market.Interval5Min, 78)
	if err != nil {
		t.Fatal(err)
	}
	if len(s.Candles) != 2 {
		t.Fatalf("malformed bar should be skipped; got %d candles", len(s.Candles))
	}
	want := time.Date(2026, 10, 23, 13, 30, 0, 0, time.UTC) // 09:30 EDT
	if !s.Candles[0].Time.Equal(want) {
		t.Fatalf("time = %v, want %v", s.Candles[0].Time, want)
	}
	if s.Candles[1].Volume != nil {
		t.Fatalf("empty volume should be nil")
	}
	if s.ExchangeTimezone != "America/New_York" {
		t.Fatalf("timezone = %q", s.ExchangeTimezone)
	}
}

func TestSearchFiltersToUS(t *testing.T) {
	c := newTestClient(t, map[string]http.HandlerFunc{
		"/symbol_search": respond(`{"data":[
			{"symbol":"AAPL","instrument_name":"Apple Inc","exchange":"NASDAQ","mic_code":"XNGS","instrument_type":"Common Stock","country":"United States","currency":"USD"},
			{"symbol":"AAPL","instrument_name":"Apple Inc","exchange":"BMV","mic_code":"XMEX","instrument_type":"Common Stock","country":"Mexico","currency":"MXN"},
			{"symbol":"AAPL","instrument_name":"Apple Inc","exchange":"NYSE","instrument_type":"Common Stock","country":"United States"},
			{"symbol":"APLE","instrument_name":"Apple Hospitality REIT","exchange":"NYSE","instrument_type":"REIT","country":"United States"}
		],"status":"ok"}`),
	}, 8)
	got, err := c.SearchSymbols(context.Background(), "apple", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].Symbol != "AAPL" || got[0].Exchange != "NASDAQ" || got[1].Symbol != "APLE" {
		t.Fatalf("got %+v", got)
	}
}

func TestMarketStatus(t *testing.T) {
	c := newTestClient(t, map[string]http.HandlerFunc{
		"/market_state": func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Query().Get("code") != "XNYS" {
				t.Errorf("code = %q", r.URL.Query().Get("code"))
			}
			_, _ = w.Write([]byte(`[{"name":"NYSE","code":"XNYS","country":"United States","is_market_open":false,
				"time_after_open":"00:00:00","time_to_open":"62:10:05","time_to_close":"00:00:00"}]`))
		},
	}, 8)
	st, err := c.MarketStatus(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if st.IsOpen || st.OpensInSeconds == nil || *st.OpensInSeconds != 62*3600+10*60+5 || st.ClosesInSeconds != nil {
		t.Fatalf("unexpected status %+v", st)
	}
}
