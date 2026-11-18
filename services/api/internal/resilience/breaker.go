// Package resilience stops calling a vendor that keeps failing. After
// Threshold failures in a row (outages, 5xx, timeouts: not refusals such as an
// unknown symbol or a rate limit), the breaker opens and calls fail at once
// for Cooldown, so the service serves its stale cache instead of every request
// waiting for the vendor's timeout. Then one probe call is let through: success
// closes the breaker, failure opens it for another Cooldown.
//
// It also counts outcomes, which /health reports so an outage is visible.
package resilience

import (
	"errors"
	"sync"
	"time"
)

// State is the breaker's state.
type State string

const (
	Closed   State = "closed"
	Open     State = "open"
	HalfOpen State = "half-open"
)

// ErrOpen is returned by Allow while the breaker refuses calls.
var ErrOpen = errors.New("vendor circuit open after repeated failures")

// Breaker is safe for concurrent use.
type Breaker struct {
	mu        sync.Mutex
	threshold int
	cooldown  time.Duration
	now       func() time.Time

	state    State
	streak   int // failures in a row
	openedAt time.Time
	probing  bool // a half-open probe is in flight

	calls, failures uint64
	lastFailureAt   time.Time
	lastFailure     string
}

// New returns a closed breaker. now may be nil.
func New(threshold int, cooldown time.Duration, now func() time.Time) *Breaker {
	if threshold < 1 {
		threshold = 1
	}
	if now == nil {
		now = time.Now
	}
	return &Breaker{threshold: threshold, cooldown: cooldown, now: now, state: Closed}
}

// Refusing reports whether Allow would fail now, without taking the probe.
// Adapters check it before booking budget, so an open breaker costs nothing.
func (b *Breaker) Refusing() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	switch b.state {
	case Open:
		return b.now().Sub(b.openedAt) < b.cooldown
	case HalfOpen:
		return b.probing
	}
	return false
}

// Allow reports whether a call may be sent. Every nil result must be followed
// by exactly one Success, Failure or Abandon.
func (b *Breaker) Allow() error {
	b.mu.Lock()
	defer b.mu.Unlock()
	switch b.state {
	case Open:
		if b.now().Sub(b.openedAt) < b.cooldown {
			return ErrOpen
		}
		b.state, b.probing = HalfOpen, true
	case HalfOpen:
		if b.probing {
			return ErrOpen
		}
		b.probing = true
	}
	b.calls++
	return nil
}

// Success records a call the vendor answered, including refusals such as
// "not found": the vendor is up.
func (b *Breaker) Success() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.state, b.streak, b.probing = Closed, 0, false
}

// Failure records a call that failed because of the vendor (unreachable, 5xx,
// timeout). code is a short reason kept for /health.
func (b *Breaker) Failure(code string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.failures++
	b.streak++
	b.lastFailureAt, b.lastFailure = b.now(), code
	if b.state == HalfOpen || b.streak >= b.threshold {
		b.state, b.openedAt = Open, b.now()
	}
	b.probing = false
}

// Abandon records a call that ended without an answer for reasons of the
// caller's own (cancelled), so it says nothing about the vendor.
func (b *Breaker) Abandon() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.probing = false
}

// Stats is a snapshot for monitoring.
type Stats struct {
	State State `json:"state"`
	// Calls and Failures count since the server started.
	Calls    uint64 `json:"calls"`
	Failures uint64 `json:"failures"`
	// ConsecutiveFailures is the current run of failures.
	ConsecutiveFailures int        `json:"consecutiveFailures"`
	LastFailureAt       *time.Time `json:"lastFailureAt"`
	LastFailure         string     `json:"lastFailure,omitempty"`
}

// Stats returns the current counters. An open breaker whose cooldown has
// passed reports half-open, as its next call will be a probe.
func (b *Breaker) Stats() Stats {
	b.mu.Lock()
	defer b.mu.Unlock()
	s := Stats{State: b.state, Calls: b.calls, Failures: b.failures, ConsecutiveFailures: b.streak, LastFailure: b.lastFailure}
	if b.state == Open && b.now().Sub(b.openedAt) >= b.cooldown {
		s.State = HalfOpen
	}
	if !b.lastFailureAt.IsZero() {
		t := b.lastFailureAt.UTC()
		s.LastFailureAt = &t
	}
	return s
}
