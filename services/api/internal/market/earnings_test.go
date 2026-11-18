package market

import (
	"context"
	"errors"
	"slices"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// calendarFake is a quote vendor with a whole-market earnings calendar.
type calendarFake struct {
	*earningsFake
	mu       sync.Mutex
	events   []EarningsEvent // the whole market
	rowCap   int             // when > 0, longer responses are cut to the last rowCap rows
	ranges   []string        // calendar ranges asked for
	symCalls atomic.Int32
	history  []EarningsSurprise
	symErr   error
}

func newCalendarFake(events ...EarningsEvent) *calendarFake {
	return &calendarFake{earningsFake: &earningsFake{namedFake: namedFake{&fakeProvider{}, "finnhub"}}, events: events}
}

func (f *calendarFake) EarningsCalendar(_ context.Context, from, to string) (CalendarPage, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.ranges = append(f.ranges, from+".."+to)
	var out []EarningsEvent
	for _, e := range f.events {
		if e.Date >= from && e.Date <= to {
			out = append(out, e)
		}
	}
	if f.rowCap > 0 && len(out) >= f.rowCap {
		// Like Finnhub: the earliest days are cut off.
		return CalendarPage{Events: out[len(out)-f.rowCap:], Truncated: true}, nil
	}
	return CalendarPage{Events: out}, nil
}

func (f *calendarFake) SymbolEarnings(_ context.Context, sym Symbol, from, to string) ([]EarningsEvent, error) {
	f.symCalls.Add(1)
	if f.symErr != nil {
		return nil, f.symErr
	}
	var out []EarningsEvent
	for _, e := range f.events {
		if e.Symbol == string(sym) && e.Date >= from && e.Date <= to {
			out = append(out, e)
		}
	}
	return out, nil
}

func (f *calendarFake) EarningsHistory(context.Context, Symbol) ([]EarningsSurprise, error) {
	f.calls.Add(1)
	return f.history, nil
}

// nyClock is 2026-11-18 03:00 UTC: still the 17th in New York.
func nyClock() *testClock { return &testClock{t: time.Date(2026, 11, 18, 3, 0, 0, 0, time.UTC)} }

func calendarService(f *calendarFake, clk *testClock) *Service {
	return newTestService(Composite{QuoteSource: f, BarSource: &fakeProvider{}}, clk)
}

func TestTodayIsTheNewYorkDate(t *testing.T) {
	s := calendarService(newCalendarFake(), nyClock())
	if got := s.Today(); got != "2026-11-17" {
		t.Fatalf("Today() = %s, want the New York date 2026-11-17", got)
	}
}

func TestCalendarIsFetchedPerWeekAndShared(t *testing.T) {
	f := newCalendarFake(
		EarningsEvent{Symbol: "NVDA", Date: "2026-11-19", Hour: "amc"},
		EarningsEvent{Symbol: "WMT", Date: "2026-11-19", Hour: "bmo"},
		EarningsEvent{Symbol: "ZZZ", Date: "2026-11-19", Hour: ""},
		EarningsEvent{Symbol: "AAPL", Date: "2026-11-02", Hour: "amc", EPSActual: f64(2.1)},
		EarningsEvent{Symbol: "CRM", Date: "2026-12-02", Hour: "amc"},
	)
	s := calendarService(f, nyClock())
	ctx := context.Background()

	res, err := s.EarningsCalendar(ctx, "2026-11-17", "2026-11-30", nil)
	if err != nil {
		t.Fatal(err)
	}
	got := make([]string, len(res.Events))
	for i, e := range res.Events {
		got[i] = e.Date + " " + e.Symbol
	}
	// In range only, by date, then before the open, after the close, unknown.
	want := []string{"2026-11-19 WMT", "2026-11-19 NVDA", "2026-11-19 ZZZ"}
	if !slices.Equal(got, want) || res.Today != "2026-11-17" || res.Freshness.Provider != "finnhub" {
		t.Fatalf("events = %v (today %s), want %v", got, res.Today, want)
	}
	asked := slices.Sorted(slices.Values(f.ranges)) // weeks are fetched concurrently
	if !slices.Equal(asked, []string{"2026-11-16..2026-11-22", "2026-11-23..2026-11-29", "2026-11-30..2026-12-06"}) {
		t.Fatalf("calendar should be asked for whole weeks, got %v", f.ranges)
	}

	// Another range in the same weeks, filtered by symbol, costs nothing.
	res, err = s.EarningsCalendar(ctx, "2026-11-19", "2026-12-04", []Symbol{"CRM", "NVDA"})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Events) != 2 || res.Events[0].Symbol != "NVDA" || res.Events[1].Symbol != "CRM" {
		t.Fatalf("filtered events = %+v", res.Events)
	}
	if len(f.ranges) != 3 {
		t.Fatalf("cached weeks were fetched again: %v", f.ranges)
	}
}

func TestCalendarSplitsRangesTheVendorCutOff(t *testing.T) {
	var events []EarningsEvent
	for d := 16; d <= 22; d++ {
		for i := range 3 {
			events = append(events, EarningsEvent{Symbol: string(rune('A'+i)) + "X", Date: time.Date(2026, 11, d, 0, 0, 0, 0, time.UTC).Format(time.DateOnly)})
		}
	}
	f := newCalendarFake(events...)
	f.rowCap = 7 // a week has 21 rows; any range over 2 days is cut off
	s := calendarService(f, nyClock())
	res, err := s.EarningsCalendar(context.Background(), "2026-11-16", "2026-11-22", nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Events) != 21 || res.Truncated {
		t.Fatalf("got %d events (truncated %v), want all 21 after splitting", len(res.Events), res.Truncated)
	}

	// A single day over the cap can't be split: say so.
	f2 := newCalendarFake(events...)
	f2.rowCap = 2
	res, err = calendarService(f2, nyClock()).EarningsCalendar(context.Background(), "2026-11-16", "2026-11-16", nil)
	if err != nil || !res.Truncated {
		t.Fatalf("a cut-off day must be reported as truncated: %+v %v", res, err)
	}
}

func TestCalendarWeeksExpireByPosition(t *testing.T) {
	today := "2026-11-18" // a Wednesday
	for _, tc := range []struct {
		monday string
		want   time.Duration
	}{
		{"2026-11-02", calendarPastTTL},
		{"2026-11-09", calendarPastTTL},
		{"2026-11-16", calendarCurrentTTL},
		{"2026-11-23", calendarFutureTTL},
	} {
		if got := calendarTTL(tc.monday, today); got != tc.want {
			t.Errorf("week of %s: TTL %v, want %v", tc.monday, got, tc.want)
		}
	}
	// On a Monday, last week's Sunday is yesterday: its late reports still count.
	if got := calendarTTL("2026-11-09", "2026-11-16"); got != calendarCurrentTTL {
		t.Errorf("yesterday's week should still refresh, got %v", got)
	}
}

func TestSymbolEarningsLastAndNext(t *testing.T) {
	f := newCalendarFake(
		EarningsEvent{Symbol: "NVDA", Date: "2026-08-26", Year: 2027, Quarter: 2, EPSActual: f64(1.05)},
		EarningsEvent{Symbol: "NVDA", Date: "2026-11-17", Hour: "amc", Year: 2027, Quarter: 3, EPSEstimate: f64(2.525)},
		EarningsEvent{Symbol: "NVDA", Date: "2027-02-23", Hour: "amc", Year: 2027, Quarter: 4},
	)
	clk := nyClock() // New York: 2026-11-17, report not out yet
	s := calendarService(f, clk)
	ctx := context.Background()
	res, err := s.SymbolEarnings(ctx, "NVDA")
	if err != nil {
		t.Fatal(err)
	}
	if res.Next == nil || res.Next.Date != "2026-11-17" || res.Last == nil || res.Last.Date != "2026-08-26" {
		t.Fatalf("before the report: next %+v last %+v", res.Next, res.Last)
	}

	// After the report the vendor has actuals; the cache near a report lasts an hour.
	f.events[1].EPSActual = f64(2.68)
	clk.advance(symbolEarningsNearTTL + time.Minute)
	res, err = s.SymbolEarnings(ctx, "NVDA")
	if err != nil {
		t.Fatal(err)
	}
	if res.Next == nil || res.Next.Date != "2027-02-23" || res.Last == nil || res.Last.Date != "2026-11-17" || *res.Last.EPSActual != 2.68 {
		t.Fatalf("after the report: next %+v last %+v", res.Next, res.Last)
	}
	if f.symCalls.Load() != 2 {
		t.Fatalf("symbol calendar calls = %d, want 2", f.symCalls.Load())
	}
}

func TestNextEarningsSharesTheSymbolCalendarCall(t *testing.T) {
	f := newCalendarFake(
		EarningsEvent{Symbol: "AAPL", Date: "2026-11-02", EPSActual: f64(2.1)},
		EarningsEvent{Symbol: "AAPL", Date: "2027-01-27", EPSEstimate: f64(2.9588)},
	)
	s := calendarService(f, nyClock())
	ctx := context.Background()
	if _, err := s.SymbolEarnings(ctx, "AAPL"); err != nil {
		t.Fatal(err)
	}
	r, err := s.NextEarnings(ctx, "AAPL")
	if err != nil || r.Next == nil || r.Next.Date != "2027-01-27" {
		t.Fatalf("next = %+v %v", r.Next, err)
	}
	if f.symCalls.Load() != 1 || f.calls.Load() != 0 {
		t.Fatalf("Stock Detail should spend one calendar call, got %d (+%d)", f.symCalls.Load(), f.calls.Load())
	}

	// Beyond the 90 days the endpoint always used, there is no next report.
	f2 := newCalendarFake(EarningsEvent{Symbol: "AAPL", Date: "2027-03-01"})
	r, err = calendarService(f2, nyClock()).NextEarnings(ctx, "AAPL")
	if err != nil || r.Next != nil {
		t.Fatalf("next = %+v %v, want none within 90 days", r.Next, err)
	}
}

func TestEarningsDetailMatchesFiscalQuarters(t *testing.T) {
	f := newCalendarFake(
		// The calendar's quarter is fiscal, like the EPS history's.
		EarningsEvent{Symbol: "NVDA", Date: "2026-11-17", Hour: "amc", Year: 2027, Quarter: 3,
			EPSActual: f64(2.68), EPSEstimate: f64(2.525), RevenueActual: f64(115.844e9), RevenueEstimate: f64(112e9)},
	)
	f.history = []EarningsSurprise{
		// Finnhub's period for this quarter is not its fiscal end; matching must not use it.
		{Period: "2026-12-31", Year: 2027, Quarter: 3, Actual: f64(2.68), Estimate: f64(2.525)},
		{Period: "2026-09-30", Year: 2027, Quarter: 2, Actual: f64(1.05), Estimate: f64(1.05)},
		{Period: "2026-06-30", Year: 2027, Quarter: 1, Actual: f64(-0.10), Estimate: f64(-0.05)},
		{Period: "2026-03-31", Year: 2026, Quarter: 4, Actual: f64(0.8), Estimate: nil},
	}
	res, err := calendarService(f, nyClock()).EarningsDetail(context.Background(), "NVDA")
	if err != nil {
		t.Fatal(err)
	}
	q := res.Quarters
	if len(q) != 4 || q[0].ReportDate != "2026-11-17" || q[0].Hour != "amc" || q[0].RevenueResult != ResultBeat ||
		q[0].RevenueSurprisePercent == nil || q[0].EPSResult != ResultBeat {
		t.Fatalf("latest quarter = %+v", q[0])
	}
	if q[1].ReportDate != "" || q[1].RevenueActual != nil || q[1].EPSResult != ResultInline {
		t.Fatalf("a quarter the calendar no longer lists has no revenue or date: %+v", q[1])
	}
	if q[2].EPSResult != ResultMiss {
		t.Fatalf("a bigger loss than expected is a miss: %+v", q[2])
	}
	if q[3].EPSResult != "" {
		t.Fatalf("no estimate, no result: %+v", q[3])
	}
	if res.EPSRecord != (EarningsRecord{Compared: 3, Beats: 1, Misses: 1, Inline: 1}) {
		t.Fatalf("record = %+v", res.EPSRecord)
	}
}

func TestEarningsDetailKeepsEPSWhenTheCalendarFails(t *testing.T) {
	f := newCalendarFake()
	f.symErr = ErrRateLimited
	f.history = []EarningsSurprise{{Year: 2026, Quarter: 4, Actual: f64(2.1), Estimate: f64(2.0)}}
	res, err := calendarService(f, nyClock()).EarningsDetail(context.Background(), "AAPL")
	if err != nil || len(res.Quarters) != 1 || res.Quarters[0].RevenueActual != nil {
		t.Fatalf("got %+v %v", res, err)
	}
}

func TestCompareResultAndSurprise(t *testing.T) {
	for _, tc := range []struct {
		actual, estimate *float64
		want             string
	}{
		{f64(2.10), f64(2.0263), ResultBeat},
		{f64(2.03), f64(2.0263), ResultBeat},   // a 0.4-cent beat is a beat
		{f64(-0.08), f64(-0.0765), ResultMiss}, // as the app has always shown it
		{f64(1.05), f64(1.05), ResultInline},
		{f64(-0.10), f64(-0.05), ResultMiss},
		{f64(0.01), f64(0), ResultBeat}, // a zero estimate is still an estimate
		{f64(0), f64(0), ResultInline},  // and a zero actual is not missing
		{nil, f64(1), ""},
		{f64(1), nil, ""},
	} {
		if got := compareResult(tc.actual, tc.estimate); got != tc.want {
			t.Errorf("compareResult(%v, %v) = %q, want %q", deref(tc.actual), deref(tc.estimate), got, tc.want)
		}
	}
	if p := SurprisePercent(f64(-0.08), f64(-0.1)); p == nil || *p < 19.99 || *p > 20.01 {
		t.Errorf("a smaller loss than expected is a positive surprise, got %v", p)
	}
	if SurprisePercent(f64(0.01), f64(0)) != nil || SurprisePercent(nil, f64(1)) != nil {
		t.Error("no percentage without a non-zero estimate and an actual")
	}
}

func deref(p *float64) any {
	if p == nil {
		return nil
	}
	return *p
}

func TestCalendarNamesComeFromWhatIsKnown(t *testing.T) {
	f := newCalendarFake(EarningsEvent{Symbol: "AAPL", Date: "2026-11-19"}, EarningsEvent{Symbol: "XYZ", Date: "2026-11-19"})
	f.quotes = map[Symbol]Quote{"AAPL": {Symbol: "AAPL", Name: "Apple Inc", Logo: "https://x/AAPL.png", Price: 1}}
	s := calendarService(f, nyClock())
	ctx := context.Background()
	if _, err := s.Quotes(ctx, []Symbol{"AAPL"}); err != nil {
		t.Fatal(err)
	}
	res, err := s.EarningsCalendar(ctx, "2026-11-19", "2026-11-19", nil)
	if err != nil {
		t.Fatal(err)
	}
	if res.Events[0].Name != "Apple Inc" || res.Events[0].Logo != "https://x/AAPL.png" || res.Events[1].Name != "" {
		t.Fatalf("names = %+v", res.Events)
	}
	if f.quoteCalls.Load() != 1 {
		t.Fatal("names must never be fetched for the calendar")
	}
}

func TestCalendarNeedsAFullCalendarVendor(t *testing.T) {
	s := newTestService(Composite{QuoteSource: &earningsFake{namedFake: namedFake{&fakeProvider{}, "x"}}, BarSource: &fakeProvider{}}, nyClock())
	if _, err := s.EarningsCalendar(context.Background(), "2026-11-17", "2026-11-18", nil); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("got %v, want ErrNotConfigured", err)
	}
	if _, err := s.SymbolEarnings(context.Background(), "AAPL"); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("got %v, want ErrNotConfigured", err)
	}
}
