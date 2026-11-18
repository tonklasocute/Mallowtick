package resilience

import (
	"errors"
	"sync"
	"testing"
	"time"
)

type clock struct{ t time.Time }

func (c *clock) now() time.Time { return c.t }

func TestOpensAfterThresholdAndProbesAfterCooldown(t *testing.T) {
	clk := &clock{t: time.Unix(0, 0)}
	b := New(3, 30*time.Second, clk.now)
	for i := range 3 {
		if err := b.Allow(); err != nil {
			t.Fatalf("call %d refused while closed: %v", i, err)
		}
		b.Failure("http_502")
	}
	if err := b.Allow(); !errors.Is(err, ErrOpen) || !b.Refusing() {
		t.Fatalf("breaker should be open after 3 failures, got %v", err)
	}
	if s := b.Stats(); s.State != Open || s.Failures != 3 || s.ConsecutiveFailures != 3 || s.LastFailure != "http_502" {
		t.Fatalf("stats = %+v", s)
	}

	clk.t = clk.t.Add(30 * time.Second)
	if b.Refusing() || b.Stats().State != HalfOpen {
		t.Fatal("after the cooldown one probe should be allowed")
	}
	if err := b.Allow(); err != nil {
		t.Fatalf("probe refused: %v", err)
	}
	if err := b.Allow(); !errors.Is(err, ErrOpen) {
		t.Fatal("only one probe at a time")
	}
	b.Failure("timeout")
	if err := b.Allow(); !errors.Is(err, ErrOpen) {
		t.Fatal("a failed probe must reopen the breaker for a full cooldown")
	}

	clk.t = clk.t.Add(30 * time.Second)
	if err := b.Allow(); err != nil {
		t.Fatal(err)
	}
	b.Success()
	if s := b.Stats(); s.State != Closed || s.ConsecutiveFailures != 0 {
		t.Fatalf("a successful probe should close the breaker: %+v", s)
	}
}

func TestSuccessResetsTheStreak(t *testing.T) {
	b := New(2, time.Minute, nil)
	_ = b.Allow()
	b.Failure("x")
	_ = b.Allow()
	b.Success()
	_ = b.Allow()
	b.Failure("x")
	if b.Refusing() {
		t.Fatal("failures that are not in a row must not open the breaker")
	}
}

func TestAbandonedProbeFreesTheSlot(t *testing.T) {
	clk := &clock{t: time.Unix(0, 0)}
	b := New(1, time.Second, clk.now)
	_ = b.Allow()
	b.Failure("x")
	clk.t = clk.t.Add(time.Second)
	if err := b.Allow(); err != nil {
		t.Fatal(err)
	}
	b.Abandon() // the caller gave up: says nothing about the vendor
	if err := b.Allow(); err != nil {
		t.Fatalf("an abandoned probe must let another through: %v", err)
	}
}

func TestConcurrentUse(t *testing.T) {
	b := New(5, time.Millisecond, nil)
	var wg sync.WaitGroup
	for i := range 50 {
		wg.Go(func() {
			if b.Allow() == nil {
				if i%2 == 0 {
					b.Failure("x")
				} else {
					b.Success()
				}
			}
			_ = b.Stats()
		})
	}
	wg.Wait()
}
