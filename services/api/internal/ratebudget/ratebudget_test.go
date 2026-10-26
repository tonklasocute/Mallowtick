package ratebudget

import (
	"context"
	"errors"
	"testing"
	"time"
)

// clock is a settable time source.
type clock struct{ t time.Time }

func (c *clock) now() time.Time { return c.t }

func TestCountsASlidingWindow(t *testing.T) {
	// The sequence Twelve Data rejected: 1 credit at :43, 7 at :54, then 1 at
	// :01 of the next minute, still within 60 seconds of the first.
	clk := &clock{t: time.Date(2026, 10, 26, 12, 30, 43, 0, time.UTC)}
	b := New(8, time.Minute)
	b.Now = clk.now
	b.Reserve(1, 0)
	clk.t = clk.t.Add(11 * time.Second)
	if e, _ := b.Reserve(7, 0); e == nil {
		t.Fatal("7 units should fit beside the first one")
	}

	clk.t = clk.t.Add(7 * time.Second)
	if e, wait := b.Reserve(1, 10*time.Second); e != nil {
		t.Fatalf("a 9th unit within the window must not be booked (wait %s)", wait)
	}
	// It becomes available once the :43 unit is a window old (plus margin).
	wantWait := time.Minute + Margin - 18*time.Second
	if e, wait := b.Reserve(1, time.Minute); e == nil || wait != wantWait {
		t.Fatalf("got wait %s, want %s", wait, wantWait)
	}
}

func TestReleaseExhaustAndAvailable(t *testing.T) {
	clk := &clock{t: time.Date(2026, 10, 26, 12, 0, 0, 0, time.UTC)}
	b := New(8, time.Minute)
	b.Now = clk.now
	e, _ := b.Reserve(8, 0)
	if b.Available() != 0 {
		t.Fatalf("available = %d, want 0", b.Available())
	}
	b.Release(e)
	if b.Available() != 8 {
		t.Fatalf("released units should be available again, got %d", b.Available())
	}

	b.Exhaust()
	if e, _ := b.Reserve(1, 30*time.Second); e != nil {
		t.Fatal("after Exhaust nothing should be available within the window")
	}
}

func TestSpendFailsFastWithoutRoom(t *testing.T) {
	b := New(1, time.Minute)
	ctx := context.Background()
	if err := b.Spend(ctx, 1, 0); err != nil {
		t.Fatal(err)
	}
	if err := b.Spend(ctx, 1, 10*time.Millisecond); !errors.Is(err, ErrNoRoom) {
		t.Fatalf("got %v, want ErrNoRoom", err)
	}
	if err := b.Spend(ctx, 2, time.Hour); !errors.Is(err, ErrNoRoom) {
		t.Fatalf("a request larger than the limit should fail, got %v", err)
	}
}
