package finnhub

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"testing"
)

func TestEarningsCalendarParsesRows(t *testing.T) {
	c := newTestClient(t, map[string]http.HandlerFunc{
		"/calendar/earnings": func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Query().Get("from") != "2026-11-16" || r.URL.Query().Get("to") != "2026-11-22" || r.URL.Query().Has("symbol") {
				t.Errorf("query = %s", r.URL.RawQuery)
			}
			_, _ = w.Write([]byte(`{"earningsCalendar":[
				{"symbol":"NVDA","date":"2026-11-17","hour":"AMC","quarter":3,"year":2027,"epsEstimate":2.525,"epsActual":2.68,"revenueEstimate":112000000000,"revenueActual":115844000000},
				{"symbol":"ADVB","date":"2026-11-17","hour":"","quarter":1,"year":2027,"epsEstimate":null,"epsActual":null,"revenueEstimate":null,"revenueActual":null},
				{"symbol":"WEIRD","date":"2026-11-17","hour":"later","quarter":1,"year":2027},
				{"symbol":"not a ticker!","date":"2026-11-17"},
				{"symbol":"AAPL","date":"soon"}
			]}`))
		},
	}, 60)
	page, err := c.EarningsCalendar(context.Background(), "2026-11-16", "2026-11-22")
	if err != nil {
		t.Fatal(err)
	}
	if page.Truncated || len(page.Events) != 3 {
		t.Fatalf("page = %+v", page)
	}
	nv := page.Events[0]
	if nv.Symbol != "NVDA" || nv.Hour != "amc" || *nv.EPSActual != 2.68 || *nv.RevenueActual != 115844000000 || nv.Year != 2027 {
		t.Fatalf("NVDA = %+v", nv)
	}
	if ad := page.Events[1]; ad.EPSEstimate != nil || ad.EPSActual != nil || ad.Hour != "" {
		t.Fatalf("missing values must stay nil, not zero: %+v", ad)
	}
	if page.Events[2].Hour != "" {
		t.Fatalf("an unknown hour is reported as unknown: %+v", page.Events[2])
	}
}

func TestEarningsCalendarAtTheRowCapIsTruncated(t *testing.T) {
	rows := make([]string, calendarRowCap)
	for i := range rows {
		rows[i] = fmt.Sprintf(`{"symbol":"S%d","date":"2026-11-17"}`, i)
	}
	c := newTestClient(t, map[string]http.HandlerFunc{
		"/calendar/earnings": respond(`{"earningsCalendar":[` + strings.Join(rows, ",") + `]}`),
	}, 60)
	page, err := c.EarningsCalendar(context.Background(), "2026-11-10", "2026-11-17")
	if err != nil || !page.Truncated {
		t.Fatalf("a response of %d rows may be cut off: truncated=%v err=%v", calendarRowCap, page.Truncated, err)
	}
}

func TestSymbolEarningsKeepsOnlyTheSymbol(t *testing.T) {
	c := newTestClient(t, map[string]http.HandlerFunc{
		"/calendar/earnings": func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Query().Get("symbol") != "AAPL" {
				t.Errorf("symbol = %q", r.URL.Query().Get("symbol"))
			}
			_, _ = w.Write([]byte(`{"earningsCalendar":[
				{"symbol":"AAPL","date":"2027-01-27","quarter":1,"year":2027,"epsEstimate":2.9588},
				{"symbol":"AAPL","date":"2026-11-02","hour":"amc","quarter":4,"year":2026,"epsActual":2.1,"revenueActual":114477000000},
				{"symbol":"AAPL.X","date":"2026-11-02"}
			]}`))
		},
	}, 60)
	events, err := c.SymbolEarnings(context.Background(), "AAPL", "2026-05-02", "2027-06-06")
	if err != nil || len(events) != 2 {
		t.Fatalf("events = %+v %v", events, err)
	}
}

func TestCachedNameNeverCallsFinnhub(t *testing.T) {
	c := newTestClient(t, map[string]http.HandlerFunc{
		"/stock/profile2": respond(`{"name":"Apple Inc","exchange":"NASDAQ NMS - GLOBAL MARKET","currency":"USD"}`),
	}, 60)
	if _, ok := c.CachedName("AAPL"); ok {
		t.Fatal("no name is known before a lookup")
	}
	if _, err := c.instrument(context.Background(), "AAPL"); err != nil {
		t.Fatal(err)
	}
	if n, ok := c.CachedName("AAPL"); !ok || n != "Apple Inc" {
		t.Fatalf("CachedName = %q %v", n, ok)
	}
}

func TestUSListingsArePricedInDollarsWhateverTheReportingCurrency(t *testing.T) {
	c := newTestClient(t, map[string]http.HandlerFunc{
		// PDD reports in yuan; its Nasdaq ADR trades in dollars.
		"/stock/profile2": respond(`{"name":"PDD Holdings Inc","exchange":"NASDAQ NMS - GLOBAL MARKET","currency":"CNY","country":"IE"}`),
		"/quote":          respond(`{"c":77.39,"d":-0.72,"dp":-0.92,"h":78.5,"l":76.9,"o":78.1,"pc":78.11,"t":1794950000}`),
	}, 60)
	q, err := c.quote(context.Background(), "PDD")
	if err != nil {
		t.Fatal(err)
	}
	if q.Currency != "USD" || q.Price != 77.39 {
		t.Fatalf("quote = %s %v, want USD 77.39", q.Currency, q.Price)
	}
}
