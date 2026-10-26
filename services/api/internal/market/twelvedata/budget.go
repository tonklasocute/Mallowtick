package twelvedata

import (
	"slices"
	"sync"
	"time"
)

const (
	// creditWindow is how far back Twelve Data counts credits: a sliding
	// minute, not the calendar minute (observed: 1 credit at :43, 7 at :54 and
	// 1 at :01 of the next minute was rejected as 9 credits).
	creditWindow = time.Minute
	// windowMargin delays a credit's expiry slightly, since the provider
	// records a request when it arrives, a little after it was sent.
	windowMargin = 2 * time.Second
)

// booking is credits spent, or about to be spent, at a point in time.
type booking struct {
	at      time.Time
	credits int
}

// creditBudget counts credits the way Twelve Data does: at most limit credits
// in any sliding 60-second window. Bookings are made in order, so a request
// never jumps ahead of one that is already waiting.
type creditBudget struct {
	mu       sync.Mutex
	limit    int
	now      func() time.Time
	bookings []*booking // in time order; future entries are waiting requests
}

func newCreditBudget(limit int) *creditBudget {
	return &creditBudget{limit: limit, now: time.Now}
}

// reserve books n credits at the earliest time the window has room and
// returns the booking and how long to wait for it. When the wait would exceed
// maxWait it books nothing, returns nil, and reports the wait it would have
// needed. n must not exceed the limit.
func (b *creditBudget) reserve(n int, maxWait time.Duration) (*booking, time.Duration) {
	b.mu.Lock()
	defer b.mu.Unlock()
	now := b.now()
	b.bookings = slices.DeleteFunc(b.bookings, func(e *booking) bool {
		return !e.at.Add(creditWindow + windowMargin).After(now)
	})

	at := now
	if len(b.bookings) > 0 {
		at = maxTime(at, b.bookings[len(b.bookings)-1].at)
	}
	for {
		used, oldest := 0, -1
		for i, e := range b.bookings {
			if e.at.Add(creditWindow + windowMargin).After(at) {
				used += e.credits
				if oldest < 0 {
					oldest = i
				}
			}
		}
		if used+n <= b.limit {
			break
		}
		// Wait until the oldest credit in the window has left it.
		at = b.bookings[oldest].at.Add(creditWindow + windowMargin)
	}
	wait := at.Sub(now)
	if wait > maxWait {
		return nil, wait
	}
	e := &booking{at: at, credits: n}
	b.bookings = append(b.bookings, e)
	return e, wait
}

// available reports how many credits can be spent right now without waiting.
// It is 0 while another request is queued, so callers do not jump ahead of it.
func (b *creditBudget) available() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	now := b.now()
	used := 0
	for _, e := range b.bookings {
		if e.at.After(now) {
			return 0
		}
		if e.at.Add(creditWindow + windowMargin).After(now) {
			used += e.credits
		}
	}
	return max(b.limit-used, 0)
}

// release drops a booking whose request was never sent.
func (b *creditBudget) release(e *booking) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.bookings = slices.DeleteFunc(b.bookings, func(x *booking) bool { return x == e })
}

// exhaust fills the window, e.g. after the provider reported its limit
// because another app shares the API key, so no request is sent until the
// provider's window has room again.
func (b *creditBudget) exhaust() {
	b.mu.Lock()
	defer b.mu.Unlock()
	at := b.now()
	if len(b.bookings) > 0 {
		at = maxTime(at, b.bookings[len(b.bookings)-1].at)
	}
	b.bookings = append(b.bookings, &booking{at: at, credits: b.limit})
}

func maxTime(a, b time.Time) time.Time {
	if b.After(a) {
		return b
	}
	return a
}
