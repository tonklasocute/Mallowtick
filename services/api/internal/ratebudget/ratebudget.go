// Package ratebudget keeps provider calls inside a per-minute allowance the
// way market-data vendors count it: at most Limit units in any sliding
// window. Twelve Data counts credits like this (observed: 1 credit at :43, 7 at
// :54 and 1 at :01 of the next minute was rejected as 9 credits); a token
// bucket or a per-calendar-minute counter both let that 9th credit through.
package ratebudget

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"sync"
	"time"
)

// Margin delays a unit's expiry slightly, since the provider records a
// request when it arrives, a little after it was sent.
const Margin = 2 * time.Second

// ErrNoRoom means the window will not have room within the allowed wait.
var ErrNoRoom = errors.New("rate budget exhausted")

// Booking is units spent, or about to be spent, at a point in time.
type Booking struct {
	at    time.Time
	units int
}

// Budget allows at most Limit units in any sliding window. Bookings are made
// in order, so a request never jumps ahead of one that is already waiting.
// It is safe for concurrent use.
type Budget struct {
	mu       sync.Mutex
	limit    int
	window   time.Duration
	bookings []*Booking // in time order; future entries are waiting requests
	// Now is the clock; tests may replace it.
	Now func() time.Time
}

// New returns a budget of limit units per window.
func New(limit int, window time.Duration) *Budget {
	return &Budget{limit: limit, window: window, Now: time.Now}
}

// Limit is the allowance per window.
func (b *Budget) Limit() int { return b.limit }

func (b *Budget) expires(e *Booking) time.Time { return e.at.Add(b.window + Margin) }

func (b *Budget) lastAt(now time.Time) time.Time {
	if n := len(b.bookings); n > 0 && b.bookings[n-1].at.After(now) {
		return b.bookings[n-1].at
	}
	return now
}

// Reserve books n units at the earliest time the window has room and returns
// the booking and how long to wait for it. When the wait would exceed maxWait
// it books nothing, returns nil, and reports the wait it would have needed.
// n must not exceed the limit.
func (b *Budget) Reserve(n int, maxWait time.Duration) (*Booking, time.Duration) {
	b.mu.Lock()
	defer b.mu.Unlock()
	now := b.Now()
	b.bookings = slices.DeleteFunc(b.bookings, func(e *Booking) bool { return !b.expires(e).After(now) })

	at := b.lastAt(now)
	for {
		used, oldest := 0, -1
		for i, e := range b.bookings {
			if b.expires(e).After(at) {
				used += e.units
				if oldest < 0 {
					oldest = i
				}
			}
		}
		if used+n <= b.limit {
			break
		}
		// Wait until the oldest unit in the window has left it.
		at = b.expires(b.bookings[oldest])
	}
	wait := at.Sub(now)
	if wait > maxWait {
		return nil, wait
	}
	e := &Booking{at: at, units: n}
	b.bookings = append(b.bookings, e)
	return e, wait
}

// Spend books n units and waits for them. It fails with ErrNoRoom when the
// wait would exceed maxWait, or with the context's error while waiting.
func (b *Budget) Spend(ctx context.Context, n int, maxWait time.Duration) error {
	if n > b.limit {
		return fmt.Errorf("%w: a request needs %d but the allowance is %d per window", ErrNoRoom, n, b.limit)
	}
	e, wait := b.Reserve(n, maxWait)
	if e == nil {
		return fmt.Errorf("%w: room again in %s", ErrNoRoom, wait.Round(time.Second))
	}
	if wait > 0 {
		t := time.NewTimer(wait)
		defer t.Stop()
		select {
		case <-t.C:
		case <-ctx.Done():
			b.Release(e)
			return ctx.Err()
		}
	}
	return nil
}

// Available reports how many units can be spent right now without waiting.
// It is 0 while another request is queued, so callers do not jump ahead of it.
func (b *Budget) Available() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	now := b.Now()
	used := 0
	for _, e := range b.bookings {
		if e.at.After(now) {
			return 0
		}
		if b.expires(e).After(now) {
			used += e.units
		}
	}
	return max(b.limit-used, 0)
}

// Release drops a booking whose request was never sent.
func (b *Budget) Release(e *Booking) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.bookings = slices.DeleteFunc(b.bookings, func(x *Booking) bool { return x == e })
}

// Exhaust fills the window, e.g. after the provider reported its limit
// because another app shares the API key, so no request is sent until the
// provider's window has room again.
func (b *Budget) Exhaust() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.bookings = append(b.bookings, &Booking{at: b.lastAt(b.Now()), units: b.limit})
}
