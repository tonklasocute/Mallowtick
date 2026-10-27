package finnhub

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/tonklasocute/mallowtick/services/api/internal/market"
)

const testKey = "test-key"

// newTestClient starts a server that checks auth and routes by path.
func newTestClient(t *testing.T, routes map[string]http.HandlerFunc, callsPerMinute int) *Client {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("X-Finnhub-Token"); got != testKey {
			t.Errorf("X-Finnhub-Token = %q", got)
		}
		if r.URL.Query().Has("token") {
			t.Error("the API key must not be sent in the query string")
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
	c, err := New(Config{APIKey: testKey, BaseURL: srv.URL, CallsPerMinute: callsPerMinute, MaxWait: 20 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func respond(body string) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(body)) }
}

func status(code int, body string) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(code)
		_, _ = w.Write([]byte(body))
	}
}

const aaplQuote = `{"c":344.77,"d":-2.955,"dp":-0.8498,"h":346.215,"l":341.03,"o":344.91,"pc":347.725,"t":1793024229}`

func TestQuoteWithProfileAndRange(t *testing.T) {
	c := newTestClient(t, map[string]http.HandlerFunc{
		"/quote":          respond(aaplQuote),
		"/stock/profile2": respond(`{"name":"Apple Inc","exchange":"NASDAQ NMS - GLOBAL MARKET","currency":"USD"}`),
		"/stock/metric":   respond(`{"metric":{"52WeekHigh":351.73,"52WeekLow":243.42}}`),
	}, 60)
	got, err := c.Quotes(context.Background(), []market.Symbol{"AAPL"})
	if err != nil {
		t.Fatal(err)
	}
	q := got["AAPL"]
	if q.Price != 344.77 || *q.Change != -2.955 || *q.PreviousClose != 347.725 || *q.Open != 344.91 {
		t.Fatalf("prices not mapped: %+v", q)
	}
	if q.Name != "Apple Inc" || q.Exchange != "NASDAQ" || q.Currency != "USD" {
		t.Fatalf("profile not mapped: %q %q %q", q.Name, q.Exchange, q.Currency)
	}
	if q.AsOf == nil || !q.AsOf.Equal(time.Unix(1793024229, 0)) || q.Volume != nil || q.IsMarketOpen != nil ||
		q.FiftyTwoWeek != nil {
		t.Fatalf("asOf should come from t; volume, market state and range are not in /quote: %+v", q)
	}

	r, err := c.FiftyTwoWeek(context.Background(), "AAPL")
	if err != nil || r == nil || r.High != 351.73 || r.Low != 243.42 {
		t.Fatalf("52-week range: %+v %v", r, err)
	}
}

func TestBatchSkipsRangeAndCachesProfiles(t *testing.T) {
	var profiles atomic.Int32
	c := newTestClient(t, map[string]http.HandlerFunc{
		"/quote": respond(aaplQuote),
		"/stock/profile2": func(w http.ResponseWriter, r *http.Request) {
			profiles.Add(1)
			_, _ = w.Write([]byte(`{"name":"` + r.URL.Query().Get("symbol") + ` Inc","exchange":"NEW YORK STOCK EXCHANGE, INC."}`))
		},
	}, 60)
	ctx := context.Background()
	for range 2 {
		got, err := c.Quotes(ctx, []market.Symbol{"AAPL", "MSFT"})
		if err != nil || len(got) != 2 {
			t.Fatalf("got %d quotes, err %v", len(got), err)
		}
		if got["MSFT"].Exchange != "NYSE" || got["MSFT"].FiftyTwoWeek != nil {
			t.Fatalf("batch quotes need no 52-week call: %+v", got["MSFT"])
		}
	}
	if profiles.Load() != 2 {
		t.Fatalf("profiles should be cached; calls = %d", profiles.Load())
	}
}

func TestETFNameComesFromSearch(t *testing.T) {
	c := newTestClient(t, map[string]http.HandlerFunc{
		"/quote":          respond(aaplQuote),
		"/stock/profile2": respond(`{}`),
		"/search": respond(`{"count":2,"result":[` +
			`{"description":"SS SPDR S&P 500 ETF TRUST-US","displaySymbol":"SPY","symbol":"SPY","type":"ETP"},` +
			`{"description":"Spyre Therapeutics Inc","symbol":"SYRE","type":"Common Stock"}]}`),
	}, 60)
	got, err := c.Quotes(context.Background(), []market.Symbol{"SPY", "QQQ"})
	if err != nil {
		t.Fatal(err)
	}
	if got["SPY"].Name != "SS SPDR S&P 500 ETF TRUST" || got["SPY"].Currency != "USD" {
		t.Fatalf("ETF name should come from search without the -US suffix: %+v", got["SPY"])
	}
}

func TestFundamentalsMapProfileAndMetrics(t *testing.T) {
	var metrics atomic.Int32
	c := newTestClient(t, map[string]http.HandlerFunc{
		"/stock/profile2": respond(`{"name":"Rocket Lab Corp","exchange":"NASDAQ NMS - GLOBAL MARKET","currency":"USD",` +
			`"country":"US","ipo":"2020-11-16","finnhubIndustry":"Aerospace & Defense",` +
			`"weburl":"https://rocketlabcorp.com/","shareOutstanding":598.46}`),
		"/stock/metric": func(w http.ResponseWriter, _ *http.Request) {
			metrics.Add(1)
			_, _ = w.Write([]byte(`{"metric":{"52WeekHigh":150.9999,"52WeekLow":37.57,"marketCapitalization":32209.104,` +
				`"peTTM":null,"psTTM":41.8764,"epsTTM":-0.2795,"revenueGrowthTTMYoy":52.53,"netProfitMarginTTM":-21.51,` +
				`"totalDebt/totalEquityQuarterly":0.0084,"beta":3.2}}`))
		},
	}, 60)
	ctx := context.Background()
	f, err := c.Fundamentals(ctx, "RKLB")
	if err != nil {
		t.Fatal(err)
	}
	if f.Industry != "Aerospace & Defense" || f.IPODate != "2020-11-16" || f.Website != "https://rocketlabcorp.com/" ||
		f.SharesOutstanding == nil || *f.SharesOutstanding != 598.46e6 {
		t.Fatalf("profile not mapped: %+v", f)
	}
	m := f.Metrics
	if m.MarketCap == nil || *m.MarketCap != 32209.104e6 || m.PE != nil || *m.EPS != -0.2795 ||
		*m.RevenueGrowthYoY != 52.53 || *m.NetMargin != -21.51 || *m.DebtToEquity != 0.0084 || m.DividendYield != nil {
		t.Fatalf("metrics not mapped (market cap in units, missing values nil): %+v", m)
	}

	r, err := c.FiftyTwoWeek(ctx, "RKLB")
	if err != nil || r == nil || r.High != 150.9999 || metrics.Load() != 1 {
		t.Fatalf("the 52-week range should be reused from the same call: %+v %v, calls = %d", r, err, metrics.Load())
	}
}

func TestUnknownSymbolIsAbsent(t *testing.T) {
	c := newTestClient(t, map[string]http.HandlerFunc{
		"/quote": respond(`{"c":0,"d":null,"dp":null,"h":0,"l":0,"o":0,"pc":0,"t":0}`),
	}, 60)
	got, err := c.Quotes(context.Background(), []market.Symbol{"ZZZZ"})
	if err != nil || len(got) != 0 {
		t.Fatalf("an unknown symbol is not an error, just absent: %v %v", got, err)
	}
}

func TestBatchReportsRateLimitWithPartialResult(t *testing.T) {
	c := newTestClient(t, map[string]http.HandlerFunc{
		"/quote":          respond(aaplQuote),
		"/stock/profile2": respond(`{"name":"X"}`),
	}, 2) // room for one quote and its profile
	got, err := c.Quotes(context.Background(), []market.Symbol{"AAPL", "MSFT", "NVDA"})
	if !errors.Is(err, market.ErrRateLimited) {
		t.Fatalf("got %v, want ErrRateLimited for the symbols left over", err)
	}
	if len(got) == 0 {
		t.Fatal("the quote that fitted should be returned")
	}
}

func TestErrorMapping(t *testing.T) {
	cases := map[int]error{
		http.StatusUnauthorized:    market.ErrUnauthorized,
		http.StatusForbidden:       market.ErrNotEntitled,
		http.StatusTooManyRequests: market.ErrRateLimited,
		http.StatusBadGateway:      market.ErrUnavailable,
	}
	for code, want := range cases {
		c := newTestClient(t, map[string]http.HandlerFunc{"/quote": status(code, `{"error":"nope"}`)}, 60)
		if _, err := c.Quotes(context.Background(), []market.Symbol{"AAPL"}); !errors.Is(err, want) {
			t.Errorf("HTTP %d: got %v, want %v", code, err, want)
		}
	}
}

func TestProviderRateLimitStopsFurtherCalls(t *testing.T) {
	var calls atomic.Int32
	c := newTestClient(t, map[string]http.HandlerFunc{
		"/quote": func(w http.ResponseWriter, _ *http.Request) {
			calls.Add(1)
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte(`{"error":"API limit reached."}`))
		},
	}, 60)
	ctx := context.Background()
	_, _ = c.Quotes(ctx, []market.Symbol{"AAPL"})
	_, _ = c.Quotes(ctx, []market.Symbol{"AAPL"})
	if calls.Load() != 1 {
		t.Fatalf("after a provider 429 no call should be sent within the window; calls = %d", calls.Load())
	}
}

func TestSearchKeepsValidUSSymbols(t *testing.T) {
	c := newTestClient(t, map[string]http.HandlerFunc{
		"/search": respond(`{"count":3,"result":[` +
			`{"description":"Apple Inc.","symbol":"AAPL","type":"Common Stock"},` +
			`{"description":"Apple Inc.","symbol":"AAPL","type":"Common Stock"},` +
			`{"description":"Odd","symbol":"AAPL:XX","type":"Common Stock"},` +
			`{"description":"Apple Hospitality REIT Inc","symbol":"APLE","type":"Common Stock"}]}`),
	}, 60)
	got, err := c.SearchSymbols(context.Background(), "apple", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].Symbol != "AAPL" || got[1].Symbol != "APLE" || got[0].Exchange != "" {
		t.Fatalf("want AAPL and APLE once each, without an exchange: %+v", got)
	}
}

func TestNextEarningsPicksTheEarliestUpcomingReport(t *testing.T) {
	c := newTestClient(t, map[string]http.HandlerFunc{
		"/calendar/earnings": func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Query().Get("from") != "2026-10-26" || r.URL.Query().Get("to") != "2027-01-24" {
				t.Errorf("unexpected window %s", r.URL.RawQuery)
			}
			_, _ = w.Write([]byte(`{"earningsCalendar":[` +
				`{"symbol":"AAPL","date":"2027-01-28","hour":"amc","quarter":1,"year":2027},` +
				`{"symbol":"AAPL","date":"2026-11-02","hour":"AMC","quarter":4,"year":2026,"epsEstimate":2.0221,"revenueEstimate":115496910249}]}`))
		},
	}, 60)
	from := time.Date(2026, 10, 26, 13, 0, 0, 0, time.UTC)
	got, err := c.NextEarnings(context.Background(), "AAPL", from)
	if err != nil {
		t.Fatal(err)
	}
	if got == nil || got.Date != "2026-11-02" || got.Hour != "amc" || *got.EPSEstimate != 2.0221 {
		t.Fatalf("unexpected next report: %+v", got)
	}

	empty := newTestClient(t, map[string]http.HandlerFunc{"/calendar/earnings": respond(`{"earningsCalendar":[]}`)}, 60)
	if got, err := empty.NextEarnings(context.Background(), "AAPL", from); err != nil || got != nil {
		t.Fatalf("no scheduled report should be nil without error: %+v %v", got, err)
	}
}

func TestCandlesNeedAPaidPlan(t *testing.T) {
	c := newTestClient(t, map[string]http.HandlerFunc{}, 60)
	if _, err := c.Candles(context.Background(), "AAPL", market.Interval1Day, 10); !errors.Is(err, market.ErrNotEntitled) {
		t.Fatalf("got %v, want ErrNotEntitled", err)
	}
}
