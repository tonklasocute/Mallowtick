package finnhub

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
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
	t.Cleanup(c.fills.wg.Wait) // background logo lookups end before the server closes
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
				`"totalDebt/totalEquityQuarterly":0.0084,"beta":3.2,"52WeekHighDate":"2026-05-27",` +
				`"52WeekPriceReturnDaily":-17.2566,"priceRelativeToS&P50052Week":-30.3878,"yearToDatePriceReturnDaily":-24.5986}}`))
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
	// The relative return is in percentage points, so the S&P 500 made -17.2566 - -30.3878.
	if m.SP500Return1Y == nil || math.Abs(*m.SP500Return1Y-13.1312) > 1e-9 || *m.PriceReturnYTD != -24.5986 ||
		m.SP500ReturnYTD != nil || *m.FiftyTwoWeekHigh != 150.9999 || m.FiftyTwoWeekHighDate != "2026-05-27" {
		t.Fatalf("returns not mapped: %+v", m)
	}

	r, err := c.FiftyTwoWeek(ctx, "RKLB")
	if err != nil || r == nil || r.High != 150.9999 || metrics.Load() != 1 {
		t.Fatalf("the 52-week range should be reused from the same call: %+v %v, calls = %d", r, err, metrics.Load())
	}
}

// together returns one handler per body. Each waits until all of them have been
// called before it answers, so calls sent one after the other fail.
func together(t *testing.T, bodies ...string) []http.HandlerFunc {
	var arrived atomic.Int32
	all := make(chan struct{})
	hs := make([]http.HandlerFunc, len(bodies))
	for i, body := range bodies {
		hs[i] = func(w http.ResponseWriter, r *http.Request) {
			if arrived.Add(1) == int32(len(bodies)) {
				close(all)
			}
			select {
			case <-all:
				_, _ = w.Write([]byte(body))
			case <-time.After(2 * time.Second):
				t.Errorf("%s was not sent alongside the other calls", r.URL.Path)
				status(http.StatusGatewayTimeout, `{"error":"alone"}`)(w, r)
			}
		}
	}
	return hs
}

// receive waits for a value from ch, failing the test after a deadline.
func receive[V any](t *testing.T, ch <-chan V) V {
	t.Helper()
	select {
	case v := <-ch:
		return v
	case <-time.After(5 * time.Second):
		t.Fatal("timed out")
		var zero V
		return zero
	}
}

func TestQuoteAndProfileAreFetchedTogether(t *testing.T) {
	h := together(t, aaplQuote, `{"name":"Apple Inc","exchange":"NASDAQ NMS - GLOBAL MARKET","currency":"USD"}`)
	c := newTestClient(t, map[string]http.HandlerFunc{"/quote": h[0], "/stock/profile2": h[1]}, 60)
	got, err := c.Quotes(context.Background(), []market.Symbol{"AAPL"})
	if q := got["AAPL"]; err != nil || q.Price != 344.77 || q.Name != "Apple Inc" || q.Exchange != "NASDAQ" {
		t.Fatalf("unexpected quote: %+v %v", q, err)
	}
}

func TestFailedProfileStillGivesTheQuote(t *testing.T) {
	var profiles atomic.Int32
	c := newTestClient(t, map[string]http.HandlerFunc{
		"/quote": respond(aaplQuote),
		"/stock/profile2": func(w http.ResponseWriter, r *http.Request) {
			profiles.Add(1)
			status(http.StatusBadGateway, `{"error":"upstream"}`)(w, r)
		},
	}, 60)
	for range 2 {
		got, err := c.Quotes(context.Background(), []market.Symbol{"AAPL"})
		if q := got["AAPL"]; err != nil || q.Price != 344.77 || q.Name != "" || q.Currency != "USD" {
			t.Fatalf("the quote should come without a name, in USD: %+v %v", q, err)
		}
	}
	if profiles.Load() != 2 {
		t.Fatalf("a failed profile should not be cached; calls = %d", profiles.Load())
	}
}

func TestQuoteBooksItsCallBeforeTheProfile(t *testing.T) {
	c := newTestClient(t, map[string]http.HandlerFunc{
		"/quote": respond(aaplQuote),
		"/stock/profile2": func(w http.ResponseWriter, r *http.Request) {
			t.Error("the profile took the only call, which the quote needed")
			respond(`{"name":"Apple Inc"}`)(w, r)
		},
	}, 1)
	got, err := c.Quotes(context.Background(), []market.Symbol{"AAPL"})
	if q := got["AAPL"]; err != nil || q.Price != 344.77 || q.Currency != "USD" {
		t.Fatalf("with room for one call the quote should get it: %+v %v", q, err)
	}
}

const rklbMetrics = `{"metric":{"52WeekHigh":150.9999,"52WeekLow":37.57,"marketCapitalization":32209.104}}`

func TestFundamentalsFetchProfileAndMetricsTogether(t *testing.T) {
	h := together(t, `{"name":"Rocket Lab Corp","finnhubIndustry":"Aerospace & Defense"}`, rklbMetrics)
	c := newTestClient(t, map[string]http.HandlerFunc{"/stock/profile2": h[0], "/stock/metric": h[1]}, 60)
	f, err := c.Fundamentals(context.Background(), "RKLB")
	if err != nil || f.Industry != "Aerospace & Defense" || f.Metrics.FiftyTwoWeekHigh == nil ||
		*f.Metrics.FiftyTwoWeekHigh != 150.9999 {
		t.Fatalf("unexpected fundamentals: %+v %v", f, err)
	}
}

func TestOneMetricCallServesRangeAndFundamentals(t *testing.T) {
	var metricCalls atomic.Int32
	metricIn, profileIn, release := make(chan struct{}), make(chan struct{}), make(chan struct{})
	profileArrived := sync.OnceFunc(func() { close(profileIn) })
	c := newTestClient(t, map[string]http.HandlerFunc{
		"/stock/profile2": func(w http.ResponseWriter, r *http.Request) {
			profileArrived()
			respond(`{"name":"Rocket Lab Corp","finnhubIndustry":"Aerospace & Defense"}`)(w, r)
		},
		"/stock/metric": func(w http.ResponseWriter, r *http.Request) {
			if metricCalls.Add(1) > 1 {
				t.Error("a second /stock/metric call was sent for the same symbol")
			} else {
				close(metricIn)
			}
			select {
			case <-release:
			case <-time.After(5 * time.Second):
				t.Error("the metric call was never released")
			}
			respond(rklbMetrics)(w, r)
		},
	}, 60)
	ctx := context.Background()

	// The quote's range lookup starts the call...
	first, leave := context.WithCancel(ctx)
	rangeErr := make(chan error, 1)
	go func() {
		_, err := c.FiftyTwoWeek(first, "RKLB")
		rangeErr <- err
	}()
	receive(t, metricIn)
	// ...and Fundamentals joins it before sending its profile request.
	funds := make(chan market.Fundamentals, 1)
	go func() {
		f, err := c.Fundamentals(ctx, "RKLB")
		if err != nil {
			t.Error(err)
		}
		funds <- f
	}()
	receive(t, profileIn)
	// The first caller leaving does not cancel the call for the other.
	leave()
	if err := receive(t, rangeErr); !errors.Is(err, context.Canceled) {
		t.Fatalf("the cancelled caller should stop waiting: %v", err)
	}
	close(release)
	f := receive(t, funds)
	if f.Industry != "Aerospace & Defense" || f.Metrics.MarketCap == nil || *f.Metrics.MarketCap != 32209.104e6 {
		t.Fatalf("unexpected fundamentals: %+v", f)
	}
	r, err := c.FiftyTwoWeek(ctx, "RKLB")
	if err != nil || r == nil || r.High != 150.9999 || metricCalls.Load() != 1 {
		t.Fatalf("the shared call should have cached the range: %+v %v, calls = %d", r, err, metricCalls.Load())
	}
}

func TestPerformanceSkipsProfiles(t *testing.T) {
	// No /stock/profile2 or /search route: newTestClient fails the test if they are called.
	c := newTestClient(t, map[string]http.HandlerFunc{
		"/quote": respond(aaplQuote),
		"/stock/metric": respond(`{"metric":{"5DayPriceReturnDaily":-1.4681,"13WeekPriceReturnDaily":4.179,` +
			`"monthToDatePriceReturnDaily":-6.3959,"yearToDatePriceReturnDaily":27.2696,"52WeekPriceReturnDaily":26.7677}}`),
	}, 60)
	ctx := context.Background()
	q, err := c.DayChanges(ctx, []market.Symbol{"XLK", "XLF"})
	if err != nil || len(q) != 2 || *q["XLK"].ChangePercent != -0.8498 || q["XLK"].Name != "" {
		t.Fatalf("unexpected day changes: %+v %v", q, err)
	}
	r, err := c.PriceReturns(ctx, "XLK")
	if err != nil || r.Day != nil || *r.Week != -1.4681 || *r.Quarter != 4.179 || *r.YTD != 27.2696 || *r.Year != 26.7677 {
		t.Fatalf("unexpected returns: %+v %v", r, err)
	}
}

func TestSearchesRunOneAtATime(t *testing.T) {
	var inFlight, most atomic.Int32
	c := newTestClient(t, map[string]http.HandlerFunc{
		"/stock/profile2": respond(`{}`),
		"/search": func(w http.ResponseWriter, _ *http.Request) {
			n := inFlight.Add(1)
			defer inFlight.Add(-1)
			for m := most.Load(); n > m && !most.CompareAndSwap(m, n); m = most.Load() {
			}
			time.Sleep(10 * time.Millisecond)
			_, _ = w.Write([]byte(`{"result":[]}`))
		},
		"/quote": respond(aaplQuote),
	}, 60)
	// Four ETF quotes in parallel each look their name up through /search.
	if _, err := c.Quotes(context.Background(), []market.Symbol{"XLK", "XLF", "XLE", "XLV"}); err != nil {
		t.Fatal(err)
	}
	if most.Load() != 1 {
		t.Fatalf("searches overlapped: %d at once", most.Load())
	}
}

func TestFailedETFNameDoesNotFailFundamentals(t *testing.T) {
	var profiles, searches atomic.Int32
	c := newTestClient(t, map[string]http.HandlerFunc{
		"/stock/profile2": func(w http.ResponseWriter, _ *http.Request) {
			profiles.Add(1)
			_, _ = w.Write([]byte(`{}`)) // ETFs have no profile
		},
		"/search": func(w http.ResponseWriter, r *http.Request) {
			searches.Add(1)
			status(http.StatusBadGateway, `{"error":"upstream"}`)(w, r)
		},
		"/stock/metric": respond(`{"metric":{"5DayPriceReturnDaily":-1.4681,"yearToDatePriceReturnDaily":27.2696}}`),
		"/quote":        respond(aaplQuote),
	}, 60)
	ctx := context.Background()
	f, err := c.Fundamentals(ctx, "XLK")
	if err != nil || f.Metrics.PriceReturnYTD == nil || *f.Metrics.PriceReturnYTD != 27.2696 {
		t.Fatalf("the returns should not depend on the ETF's name: %+v %v", f, err)
	}
	// The name-less profile is kept for a while, so neither a quote nor another
	// lookup spends the profile and search calls again.
	q, err := c.Quotes(ctx, []market.Symbol{"XLK"})
	if err != nil || q["XLK"].Name != "" || q["XLK"].Currency != "USD" {
		t.Fatalf("unexpected quote: %+v %v", q, err)
	}
	if _, err := c.Fundamentals(ctx, "XLK"); err != nil || profiles.Load() != 1 || searches.Load() != 1 {
		t.Fatalf("profile and name should be looked up once: profiles = %d, searches = %d, err = %v",
			profiles.Load(), searches.Load(), err)
	}
}

func TestEarningsHistoryAndRecommendationsAreNewestFirst(t *testing.T) {
	c := newTestClient(t, map[string]http.HandlerFunc{
		"/stock/earnings": respond(`[` +
			`{"actual":-0.09,"estimate":-0.0942,"period":"2025-12-31","quarter":4,"surprise":0.0042,"surprisePercent":4.4586,"year":2025},` +
			`{"actual":-0.08,"estimate":-0.0765,"period":"2026-06-30","quarter":2,"surprise":-0.0035,"surprisePercent":-4.5752,"year":2026}]`),
		"/stock/recommendation": respond(`[` +
			`{"period":"2026-09-01","strongBuy":7,"buy":14,"hold":5,"sell":0,"strongSell":0,"symbol":"RKLB"},` +
			`{"period":"2026-10-01","strongBuy":7,"buy":16,"hold":5,"sell":0,"strongSell":0,"symbol":"RKLB"}]`),
	}, 60)
	ctx := context.Background()
	h, err := c.EarningsHistory(ctx, "RKLB")
	if err != nil || len(h) != 2 || h[0].Period != "2026-06-30" || h[0].Quarter != 2 || *h[0].Actual != -0.08 ||
		*h[0].SurprisePercent != -4.5752 {
		t.Fatalf("earnings history: %+v %v", h, err)
	}
	r, err := c.Recommendations(ctx, "RKLB")
	if err != nil || len(r) != 2 || r[0].Period != "2026-10-01" || r[0].Buy != 16 || r[0].StrongBuy != 7 {
		t.Fatalf("recommendations: %+v %v", r, err)
	}
}

func TestUnknownSymbolIsAbsent(t *testing.T) {
	c := newTestClient(t, map[string]http.HandlerFunc{
		"/quote": respond(`{"c":0,"d":null,"dp":null,"h":0,"l":0,"o":0,"pc":0,"t":0}`),
		// The profile is asked for alongside the quote, so it is sent anyway.
		"/stock/profile2": respond(`{}`),
		"/search":         respond(`{"result":[]}`),
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
		c := newTestClient(t, map[string]http.HandlerFunc{
			"/quote":          status(code, `{"error":"nope"}`),
			"/stock/profile2": respond(`{"name":"Apple Inc"}`),
		}, 60)
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
		"/stock/profile2": respond(`{"name":"Apple Inc"}`),
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
		"/stock/profile2": respond(`{}`),
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

const aaplLogo = "https://static2.finnhub.io/file/publicdatany/finnhubimage/stock_logo/AAPL.png"

func TestQuoteCarriesTheProfileLogo(t *testing.T) {
	c := newTestClient(t, map[string]http.HandlerFunc{
		"/quote":          respond(aaplQuote),
		"/stock/profile2": respond(`{"name":"Apple Inc","exchange":"NASDAQ NMS - GLOBAL MARKET","logo":"` + aaplLogo + `"}`),
	}, 60)
	got, err := c.Quotes(context.Background(), []market.Symbol{"AAPL"})
	if err != nil || got["AAPL"].Logo != aaplLogo {
		t.Fatalf("the quote should carry the profile's logo: %+v %v", got["AAPL"], err)
	}
}

func TestCleanLogoKeepsOnlyHTTPS(t *testing.T) {
	for in, want := range map[string]string{
		aaplLogo:                          aaplLogo,
		"  " + aaplLogo + " ":             aaplLogo,
		"":                                "",
		"http://static2.finnhub.io/a.png": "",
		"javascript:alert(1)":             "",
		"//static2.finnhub.io/a.png":      "",
		"not a url":                       "",
	} {
		if got := cleanLogo(in); got != want {
			t.Errorf("cleanLogo(%q) = %q, want %q", in, got, want)
		}
	}
}

// profiles serves /stock/profile2 with the given logos (an ETF's empty profile
// for other symbols) and counts the calls per symbol.
type profiles struct {
	logos   map[string]string
	entered chan string   // when set, gets each call's symbol as it arrives
	release chan struct{} // when set, calls answer once it is closed
	mu      sync.Mutex
	calls   map[string]int
}

func (p *profiles) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	sym := r.URL.Query().Get("symbol")
	p.mu.Lock()
	if p.calls == nil {
		p.calls = map[string]int{}
	}
	p.calls[sym]++
	p.mu.Unlock()
	if p.entered != nil {
		p.entered <- sym
	}
	if p.release != nil {
		select {
		case <-p.release:
		case <-r.Context().Done():
			return
		}
	}
	if logo, ok := p.logos[sym]; ok {
		_, _ = fmt.Fprintf(w, `{"name":"%s Inc","logo":"%s"}`, sym, logo)
		return
	}
	_, _ = w.Write([]byte(`{}`))
}

func (p *profiles) counts() map[string]int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return maps.Clone(p.calls)
}

// hold makes p's calls wait until release runs. Tests also run release in a
// cleanup registered after newTestClient, so that it runs before the client's
// cleanup waits for the lookups.
func (p *profiles) hold() (release func()) {
	p.entered, p.release = make(chan string, 20), make(chan struct{})
	return sync.OnceFunc(func() { close(p.release) })
}

// searchResults is a /search answer listing symbols as common stocks.
func searchResults(symbols ...string) http.HandlerFunc {
	rows := make([]string, len(symbols))
	for i, s := range symbols {
		rows[i] = fmt.Sprintf(`{"description":"%s Inc","symbol":"%s","type":"Common Stock"}`, s, s)
	}
	return respond(`{"result":[` + strings.Join(rows, ",") + `]}`)
}

// searchNow runs a search and fails the test unless it answers promptly.
func searchNow(t *testing.T, c *Client, query string) []market.Instrument {
	t.Helper()
	type result struct {
		found []market.Instrument
		err   error
	}
	done := make(chan result, 1)
	go func() {
		found, err := c.SearchSymbols(context.Background(), query, 10)
		done <- result{found, err}
	}()
	select {
	case r := <-done:
		if r.err != nil {
			t.Fatal(r.err)
		}
		return r.found
	case <-time.After(5 * time.Second):
		t.Fatal("the search waited for its logos")
		return nil
	}
}

// receiveN takes n values from ch, failing the test if they do not come.
func receiveN(t *testing.T, ch <-chan string, n int) []string {
	t.Helper()
	got := make([]string, 0, n)
	deadline := time.After(5 * time.Second)
	for len(got) < n {
		select {
		case s := <-ch:
			got = append(got, s)
		case <-deadline:
			t.Fatalf("got %v, want %d values", got, n)
		}
	}
	return got
}

func TestSearchAnswersBeforeItsLogosAndTheNextSearchHasThem(t *testing.T) {
	p := &profiles{logos: map[string]string{"AAPL": aaplLogo}}
	release := p.hold()
	c := newTestClient(t, map[string]http.HandlerFunc{
		"/search": respond(`{"result":[` +
			`{"description":"Apple Inc.","symbol":"AAPL","type":"Common Stock"},` +
			`{"description":"SS SPDR S&P 500 ETF TRUST-US","symbol":"SPY","type":"ETP"}]}`),
		"/stock/profile2": p.ServeHTTP,
	}, 60)
	t.Cleanup(release)

	// The profile calls are held, so the search must answer without them.
	got := searchNow(t, c, "apple")
	if len(got) != 2 || got[0].Logo != "" || got[1].Logo != "" {
		t.Fatalf("logos are not known yet: %+v", got)
	}
	receiveN(t, p.entered, 2)
	release()
	c.fills.wg.Wait()

	for range 2 {
		got := searchNow(t, c, "apple")
		if len(got) != 2 || got[0].Logo != aaplLogo || got[1].Logo != "" {
			t.Fatalf("AAPL should now have a logo and the ETF none: %+v", got)
		}
	}
	c.fills.wg.Wait()
	if want := map[string]int{"AAPL": 1, "SPY": 1}; !maps.Equal(p.counts(), want) {
		t.Fatalf("each profile should be fetched once, ETF included; calls = %v", p.counts())
	}
}

func TestSearchTakesKnownLogosFromTheCache(t *testing.T) {
	p := &profiles{}
	c := newTestClient(t, map[string]http.HandlerFunc{
		"/search":         searchResults("AAPL", "SPY", "MSFT"),
		"/stock/profile2": p.ServeHTTP,
	}, 60)
	c.logos.Set("AAPL", aaplLogo)
	c.logos.Set("SPY", "") // known to have none
	got := searchNow(t, c, "a")
	if len(got) != 3 || got[0].Logo != aaplLogo || got[1].Logo != "" || got[2].Logo != "" {
		t.Fatalf("the cached logo should be attached: %+v", got)
	}
	c.fills.wg.Wait()
	if want := map[string]int{"MSFT": 1}; !maps.Equal(p.counts(), want) {
		t.Fatalf("only the unknown logo should be looked up; calls = %v", p.counts())
	}
}

func TestBackgroundLogosAreBoundedAndLookedUpOnce(t *testing.T) {
	symbols := []string{"AAPL", "AMZN", "AMD", "ABNB", "ADBE", "ACN", "ABT", "AVGO"}
	p := &profiles{}
	release := p.hold()
	c := newTestClient(t, map[string]http.HandlerFunc{
		"/search":         searchResults(symbols...),
		"/stock/profile2": p.ServeHTTP,
	}, 60)
	t.Cleanup(release)

	searchNow(t, c, "a")
	receiveN(t, p.entered, min(parallelCalls, maxLogoFills))
	// Another search for the same symbols while those lookups are held.
	searchNow(t, c, "ab")
	release()
	c.fills.wg.Wait()

	want := map[string]int{}
	for _, s := range symbols[:maxLogoFills] {
		want[s] = 1
	}
	if !maps.Equal(p.counts(), want) {
		t.Fatalf("each of the first %d results should be looked up once; calls = %v", maxLogoFills, p.counts())
	}
}

func TestBackgroundLogosNeedRoomToSpare(t *testing.T) {
	// The search spends one call, leaving one less than the headroom.
	p := &profiles{logos: map[string]string{"AAPL": aaplLogo}}
	c := newTestClient(t, map[string]http.HandlerFunc{
		"/search":         searchResults("AAPL"),
		"/stock/profile2": p.ServeHTTP,
	}, logoHeadroom)
	searchNow(t, c, "apple")
	c.fills.wg.Wait()
	if len(p.counts()) != 0 {
		t.Fatalf("a logo must not take the budget's last room; calls = %v", p.counts())
	}
	if _, busy := c.fills.running.Load(market.Symbol("AAPL")); busy {
		t.Fatal("a skipped lookup should be left for a later search")
	}

	// With one call more, the same search looks the logo up.
	roomy := newTestClient(t, map[string]http.HandlerFunc{
		"/search":         searchResults("AAPL"),
		"/stock/profile2": p.ServeHTTP,
	}, logoHeadroom+1)
	searchNow(t, roomy, "apple")
	roomy.fills.wg.Wait()
	if logo, known := roomy.CachedLogo("AAPL"); !known || logo != aaplLogo {
		t.Fatalf("with room to spare the logo should be looked up: %q %v", logo, known)
	}
}

func TestSearchStillAnswersWhenLogosCannotBeFetched(t *testing.T) {
	c := newTestClient(t, map[string]http.HandlerFunc{
		"/search":         respond(`{"result":[{"description":"Apple Inc.","symbol":"AAPL","type":"Common Stock"}]}`),
		"/stock/profile2": status(http.StatusServiceUnavailable, `{"error":"down"}`),
	}, 60)
	got, err := c.SearchSymbols(context.Background(), "apple", 10)
	if err != nil || len(got) != 1 || got[0].Symbol != "AAPL" || got[0].Logo != "" {
		t.Fatalf("a failed profile call must only cost the logo: %+v %v", got, err)
	}
	c.fills.wg.Wait()
	if _, known := c.CachedLogo("AAPL"); known {
		t.Fatal("a failed lookup should not be cached, so a later search tries again")
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
