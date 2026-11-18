package market

import (
	"cmp"
	"context"
	"log/slog"
	"math"
	"slices"
	"sync"
	"time"

	"golang.org/x/sync/errgroup"

	"github.com/tonklasocute/mallowtick/services/api/internal/cache"
)

// CalendarPage is one vendor response for an earnings calendar range.
type CalendarPage struct {
	Events []EarningsEvent
	// Truncated reports that the vendor returned as many rows as it ever does,
	// so some reports in the range may be missing.
	Truncated bool
}

// EarningsCalendarProvider is implemented by vendors whose earnings calendar
// covers the whole market and past reports with their actual figures.
type EarningsCalendarProvider interface {
	// EarningsCalendar returns every report scheduled from from to to
	// (YYYY-MM-DD, New York dates), past ones with their actuals.
	EarningsCalendar(ctx context.Context, from, to string) (CalendarPage, error)
	// SymbolEarnings returns symbol's reports in the range. Finnhub gives at
	// most the latest past report and the next one.
	SymbolEarnings(ctx context.Context, symbol Symbol, from, to string) ([]EarningsEvent, error)
}

// NameSource is implemented by vendors that keep the company names they have
// looked up, so lists can show names without a lookup per row.
type NameSource interface {
	// CachedName returns symbol's name without calling the vendor.
	CachedName(symbol Symbol) (string, bool)
}

const (
	// CalendarMaxDays bounds one calendar request; CalendarReachDays bounds how
	// far from today it may start or end.
	CalendarMaxDays   = 35
	CalendarReachDays = 180
	// The calendar is cached per week. Past weeks no longer change; the current
	// one gets actuals during the day; later ones get dates confirmed or moved.
	calendarPastTTL    = 24 * time.Hour
	calendarCurrentTTL = 30 * time.Minute
	calendarFutureTTL  = 6 * time.Hour
	calendarFetches    = 3
	// symbolEarningsDays is how far back and ahead one symbol's reports are
	// asked for: enough for the latest and the next quarter.
	symbolEarningsDays = 200
	// A report within a day of today is refetched hourly, for its actuals.
	symbolEarningsNearTTL = time.Hour
	// nextEarningsDays matches the horizon /stocks/{symbol}/earnings always had.
	nextEarningsDays = 90
)

// A result is "inline" only when it equals the estimate (up to float noise).
// Estimates are consensus averages such as -0.0765, and the app has always
// shown -0.08 against them as a miss: a sub-cent difference is still one.
const inlineTolerance = 1e-9

// Result of a reported figure against its estimate.
const (
	ResultBeat   = "beat"
	ResultMiss   = "miss"
	ResultInline = "inline"
)

var newYorkLocation = sync.OnceValue(func() *time.Location {
	if loc, err := time.LoadLocation("America/New_York"); err == nil {
		return loc
	}
	return time.FixedZone("EST", -5*60*60)
})

// Today is the current date in New York, where US earnings dates are set.
func (s *Service) Today() string {
	return s.cfg.Now().In(newYorkLocation()).Format(time.DateOnly)
}

// AddDays shifts a YYYY-MM-DD date.
func AddDays(date string, days int) string {
	t, err := time.Parse(time.DateOnly, date)
	if err != nil {
		return date
	}
	return t.AddDate(0, 0, days).Format(time.DateOnly)
}

// daysBetween is the number of days from a to b (YYYY-MM-DD).
func daysBetween(a, b string) int {
	ta, err1 := time.Parse(time.DateOnly, a)
	tb, err2 := time.Parse(time.DateOnly, b)
	if err1 != nil || err2 != nil {
		return 0
	}
	return int(math.Round(tb.Sub(ta).Hours() / 24))
}

// weekStart is the Monday of date's week.
func weekStart(date string) string {
	t, err := time.Parse(time.DateOnly, date)
	if err != nil {
		return date
	}
	back := (int(t.Weekday()) + 6) % 7 // Monday = 0
	return t.AddDate(0, 0, -back).Format(time.DateOnly)
}

// calendarWeek is one week of the whole market's reports.
type calendarWeek struct {
	Events    []EarningsEvent
	Truncated bool
}

// EarningsCalendarResult lists reports between From and To, by date.
type EarningsCalendarResult struct {
	From string `json:"from"`
	To   string `json:"to"`
	// Today is the New York date the API used, so clients split past, today
	// and upcoming the same way.
	Today  string          `json:"today"`
	Events []EarningsEvent `json:"events"`
	// Truncated is true when the vendor's row limit may have left reports out.
	Truncated bool      `json:"truncated"`
	Freshness Freshness `json:"freshness"`
}

// EarningsCalendar returns the reports between from and to (inclusive,
// YYYY-MM-DD), for symbols only when given. The whole market's calendar is
// fetched and cached per week, so every request and every user shares it.
func (s *Service) EarningsCalendar(ctx context.Context, from, to string, symbols []Symbol) (EarningsCalendarResult, error) {
	cp, ok := s.source(KindEarnings).(EarningsCalendarProvider)
	if !ok {
		return EarningsCalendarResult{}, ErrNotConfigured
	}
	today := s.Today()
	var weeks []string
	for w := weekStart(from); w <= to; w = AddDays(w, 7) {
		weeks = append(weeks, w)
	}
	entries := make([]cache.Entry[calendarWeek], len(weeks))
	stale := make([]bool, len(weeks))
	g, gctx := errgroup.WithContext(ctx)
	g.SetLimit(calendarFetches)
	for i, w := range weeks {
		g.Go(func() error {
			ttl := func(calendarWeek) time.Duration { return calendarTTL(w, today) }
			e, st, err := load(gctx, s, s.calendar, "ecal:"+w, ttl, func(fctx context.Context) (calendarWeek, error) {
				return fetchCalendar(fctx, cp, w, AddDays(w, 6))
			})
			entries[i], stale[i] = e, st
			return err
		})
	}
	if err := g.Wait(); err != nil {
		return EarningsCalendarResult{}, err
	}

	want := make(map[Symbol]bool, len(symbols))
	for _, sym := range symbols {
		want[sym] = true
	}
	res := EarningsCalendarResult{From: from, To: to, Today: today, Events: []EarningsEvent{}}
	seen := make(map[string]bool)
	fetchedAt := time.Time{}
	for _, e := range entries {
		res.Truncated = res.Truncated || e.Value.Truncated
		if fetchedAt.IsZero() || e.StoredAt.Before(fetchedAt) {
			fetchedAt = e.StoredAt
		}
		for _, ev := range e.Value.Events {
			key := ev.Symbol + "|" + ev.Date
			if ev.Date < from || ev.Date > to || seen[key] || (len(want) > 0 && !want[Symbol(ev.Symbol)]) {
				continue
			}
			seen[key] = true
			res.Events = append(res.Events, s.withKnownName(ev))
		}
	}
	sortEvents(res.Events)
	res.Freshness = s.freshness(KindEarnings, nil, fetchedAt, slices.Contains(stale, true))
	return res, nil
}

// calendarTTL keeps a week of the calendar according to where it lies.
func calendarTTL(monday, today string) time.Duration {
	sunday := AddDays(monday, 6)
	switch {
	case sunday < AddDays(today, -1):
		return calendarPastTTL
	case monday > today:
		return calendarFutureTTL
	default:
		return calendarCurrentTTL
	}
}

// fetchCalendar asks for from..to, halving the range while the vendor's row
// limit cuts it off. A single day at the limit stays truncated.
func fetchCalendar(ctx context.Context, cp EarningsCalendarProvider, from, to string) (calendarWeek, error) {
	page, err := cp.EarningsCalendar(ctx, from, to)
	if err != nil {
		return calendarWeek{}, err
	}
	if !page.Truncated || from >= to {
		return calendarWeek(page), nil
	}
	mid := AddDays(from, daysBetween(from, to)/2)
	a, err := fetchCalendar(ctx, cp, from, mid)
	if err != nil {
		return calendarWeek{}, err
	}
	b, err := fetchCalendar(ctx, cp, AddDays(mid, 1), to)
	if err != nil {
		return calendarWeek{}, err
	}
	return calendarWeek{Events: append(slices.Clip(a.Events), b.Events...), Truncated: a.Truncated || b.Truncated}, nil
}

// hourOrder sorts a day's reports as they happen.
var hourOrder = map[string]int{"bmo": 0, "dmh": 1, "amc": 2, "": 3}

func sortEvents(events []EarningsEvent) {
	slices.SortFunc(events, func(a, b EarningsEvent) int {
		return cmp.Or(cmp.Compare(a.Date, b.Date), cmp.Compare(hourOrder[a.Hour], hourOrder[b.Hour]), cmp.Compare(a.Symbol, b.Symbol))
	})
}

// withKnownName fills in the name and logo the API already knows for the
// event's symbol (cached quotes, then the vendor's profiles), never fetching.
func (s *Service) withKnownName(ev EarningsEvent) EarningsEvent {
	sym := Symbol(ev.Symbol)
	if e, state := s.quotes.Get(ev.Symbol); state != cache.Miss && e.Value.Name != "" {
		ev.Name, ev.Logo = e.Value.Name, e.Value.Logo
		return ev
	}
	src := s.source(KindEarnings)
	if n, ok := src.(NameSource); ok {
		ev.Name, _ = n.CachedName(sym)
	}
	if l, ok := src.(LogoSource); ok {
		ev.Logo, _ = l.CachedLogo(sym)
	}
	return ev
}

// SymbolEarningsResult is one symbol's latest and next report.
type SymbolEarningsResult struct {
	Symbol Symbol `json:"symbol"`
	Today  string `json:"today"`
	// Next is the earliest report today or later that has no actuals yet.
	Next *EarningsEvent `json:"next"`
	// Last is the latest report with actuals, or one already past.
	Last      *EarningsEvent `json:"last"`
	Freshness Freshness      `json:"freshness"`
}

// symbolEvents returns symbol's reports around today, cached per symbol.
func (s *Service) symbolEvents(ctx context.Context, cp EarningsCalendarProvider, symbol Symbol) (cache.Entry[[]EarningsEvent], bool, error) {
	today := s.Today()
	ttl := func(events []EarningsEvent) time.Duration {
		for _, ev := range events {
			if d := daysBetween(today, ev.Date); d >= -1 && d <= 1 {
				return symbolEarningsNearTTL
			}
		}
		return earningsTTL
	}
	return load(ctx, s, s.symbolEarnings, "symearn:"+string(symbol), ttl, func(fctx context.Context) ([]EarningsEvent, error) {
		return cp.SymbolEarnings(fctx, symbol, AddDays(today, -symbolEarningsDays), AddDays(today, symbolEarningsDays))
	})
}

// SymbolEarnings returns symbol's latest and next earnings report. It fails
// with ErrNotConfigured without a vendor whose calendar covers past reports.
func (s *Service) SymbolEarnings(ctx context.Context, symbol Symbol) (SymbolEarningsResult, error) {
	cp, ok := s.source(KindEarnings).(EarningsCalendarProvider)
	if !ok {
		return SymbolEarningsResult{}, ErrNotConfigured
	}
	e, stale, err := s.symbolEvents(ctx, cp, symbol)
	if err != nil {
		return SymbolEarningsResult{}, err
	}
	today := s.Today()
	res := SymbolEarningsResult{Symbol: symbol, Today: today, Freshness: s.freshness(KindEarnings, nil, e.StoredAt, stale)}
	for _, ev := range e.Value {
		ev := s.withKnownName(ev)
		reported := ev.EPSActual != nil || ev.RevenueActual != nil
		if !reported && ev.Date >= today && (res.Next == nil || ev.Date < res.Next.Date) {
			res.Next = &ev
		}
		if (reported || ev.Date < today) && (res.Last == nil || ev.Date > res.Last.Date) {
			res.Last = &ev
		}
	}
	return res, nil
}

// nextFromEvents is the earliest report from today within the horizon that
// /stocks/{symbol}/earnings has always used.
func nextFromEvents(events []EarningsEvent, today string) *EarningsEvent {
	limit := AddDays(today, nextEarningsDays)
	var next *EarningsEvent
	for _, ev := range events {
		if ev.Date >= today && ev.Date <= limit && (next == nil || ev.Date < next.Date) {
			next = &ev
		}
	}
	return next
}

// EarningsQuarter is a reported quarter with EPS and, when the vendor reported
// that quarter's revenue too, revenue against the estimates.
type EarningsQuarter struct {
	EarningsSurprise
	// ReportDate (YYYY-MM-DD, New York) and Hour come from the calendar; empty
	// for quarters it no longer lists.
	ReportDate string `json:"reportDate"`
	Hour       string `json:"hour"`
	// EPSResult and RevenueResult are beat, miss or inline; empty when the
	// actual or the estimate is missing.
	EPSResult              string   `json:"epsResult"`
	RevenueActual          *float64 `json:"revenueActual"`
	RevenueEstimate        *float64 `json:"revenueEstimate"`
	RevenueSurprisePercent *float64 `json:"revenueSurprisePercent"`
	RevenueResult          string   `json:"revenueResult"`
}

// EarningsRecord counts EPS results over the quarters listed.
type EarningsRecord struct {
	// Compared is the number of quarters with both an actual and an estimate.
	Compared int `json:"compared"`
	Beats    int `json:"beats"`
	Misses   int `json:"misses"`
	Inline   int `json:"inline"`
}

// EarningsDetailResult is a symbol's reported quarters, newest first.
type EarningsDetailResult struct {
	Symbol    Symbol            `json:"symbol"`
	Quarters  []EarningsQuarter `json:"quarters"`
	EPSRecord EarningsRecord    `json:"epsRecord"`
	Freshness Freshness         `json:"freshness"`
}

// EarningsDetail combines the reported EPS history with the calendar's dates
// and revenue. Quarters are matched by fiscal year and quarter only, never by
// date, so fiscal and calendar periods are not mixed.
func (s *Service) EarningsDetail(ctx context.Context, symbol Symbol) (EarningsDetailResult, error) {
	hist, err := s.EarningsHistory(ctx, symbol)
	if err != nil {
		return EarningsDetailResult{}, err
	}
	var events []EarningsEvent
	if cp, ok := s.source(KindEarnings).(EarningsCalendarProvider); ok {
		// Revenue and dates are extras: without them the EPS history still stands.
		if e, _, err := s.symbolEvents(ctx, cp, symbol); err == nil {
			events = e.Value
		} else {
			s.log.DebugContext(ctx, "earnings calendar unavailable for history", slog.String("symbol", string(symbol)), slog.Any("error", err))
		}
	}
	return s.buildDetail(symbol, hist.Quarters, events, hist.Freshness), nil
}

// buildDetail matches quarters with calendar events by fiscal year and quarter.
func (s *Service) buildDetail(symbol Symbol, quarters []EarningsSurprise, events []EarningsEvent, fresh Freshness) EarningsDetailResult {
	byQuarter := make(map[[2]int]EarningsEvent)
	for _, ev := range events {
		if ev.Year > 0 && ev.Quarter > 0 {
			byQuarter[[2]int{ev.Year, ev.Quarter}] = ev
		}
	}
	res := EarningsDetailResult{Symbol: symbol, Quarters: make([]EarningsQuarter, 0, len(quarters)), Freshness: fresh}
	for _, q := range quarters {
		eq := EarningsQuarter{EarningsSurprise: q, EPSResult: compareResult(q.Actual, q.Estimate)}
		if ev, ok := byQuarter[[2]int{q.Year, q.Quarter}]; ok {
			eq.ReportDate, eq.Hour = ev.Date, ev.Hour
			eq.RevenueActual, eq.RevenueEstimate = ev.RevenueActual, ev.RevenueEstimate
			eq.RevenueSurprisePercent = SurprisePercent(ev.RevenueActual, ev.RevenueEstimate)
			eq.RevenueResult = compareResult(ev.RevenueActual, ev.RevenueEstimate)
		}
		switch eq.EPSResult {
		case ResultBeat:
			res.EPSRecord.Beats++
		case ResultMiss:
			res.EPSRecord.Misses++
		case ResultInline:
			res.EPSRecord.Inline++
		}
		if eq.EPSResult != "" {
			res.EPSRecord.Compared++
		}
		res.Quarters = append(res.Quarters, eq)
	}
	return res
}

// compareResult says whether actual beat, missed or matched estimate; "" when
// either is missing. A zero estimate is a real estimate.
func compareResult(actual, estimate *float64) string {
	if actual == nil || estimate == nil {
		return ""
	}
	switch d := *actual - *estimate; {
	case math.Abs(d) <= inlineTolerance:
		return ResultInline
	case d > 0:
		return ResultBeat
	default:
		return ResultMiss
	}
}

// SurprisePercent is (actual − estimate) / |estimate| in percent, so a smaller
// loss than expected is positive. Nil when either is missing or the estimate
// is zero (no meaningful percentage).
func SurprisePercent(actual, estimate *float64) *float64 {
	if actual == nil || estimate == nil || *estimate == 0 {
		return nil
	}
	p := (*actual - *estimate) / math.Abs(*estimate) * 100
	return &p
}

// CachedEarningsDetail builds EarningsDetail from what is cached, never
// calling the vendor. ok is false when the EPS history isn't cached.
func (s *Service) CachedEarningsDetail(symbol Symbol) (EarningsDetailResult, bool) {
	hist, state := s.surprises.Get("surprises:" + string(symbol))
	if state == cache.Miss {
		return EarningsDetailResult{}, false
	}
	events, _ := s.symbolEarnings.Get("symearn:" + string(symbol))
	return s.buildDetail(symbol, hist.Value, events.Value,
		s.freshness(KindEarnings, nil, hist.StoredAt, state == cache.Stale)), true
}
