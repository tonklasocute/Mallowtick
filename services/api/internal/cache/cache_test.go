package cache

import (
	"testing"
	"time"
)

type clock struct{ t time.Time }

func (c *clock) now() time.Time          { return c.t }
func (c *clock) advance(d time.Duration) { c.t = c.t.Add(d) }

func TestTTLStates(t *testing.T) {
	clk := &clock{t: time.Date(2026, 1, 2, 15, 0, 0, 0, time.UTC)}
	c := New[int](time.Minute, time.Hour, 0, clk.now)

	if _, st := c.Get("a"); st != Miss {
		t.Fatalf("empty cache: got state %v, want Miss", st)
	}
	c.Set("a", 1)
	if e, st := c.Get("a"); st != Fresh || e.Value != 1 {
		t.Fatalf("got %v/%v, want Fresh/1", st, e.Value)
	}
	clk.advance(2 * time.Minute)
	if e, st := c.Get("a"); st != Stale || e.Value != 1 {
		t.Fatalf("after ttl: got %v/%v, want Stale/1", st, e.Value)
	}
	clk.advance(time.Hour)
	if _, st := c.Get("a"); st != Miss {
		t.Fatalf("after retention: got %v, want Miss", st)
	}
}

func TestSetWithTTLOverridesDefault(t *testing.T) {
	clk := &clock{t: time.Unix(0, 0)}
	c := New[string](time.Minute, time.Hour, 0, clk.now)
	c.SetWithTTL("k", "v", 10*time.Minute)
	clk.advance(5 * time.Minute)
	if _, st := c.Get("k"); st != Fresh {
		t.Fatalf("got %v, want Fresh", st)
	}
}

func TestEvictsOldestWhenFull(t *testing.T) {
	clk := &clock{t: time.Unix(0, 0)}
	c := New[int](time.Minute, time.Hour, 2, clk.now)
	c.Set("a", 1)
	clk.advance(time.Second)
	c.Set("b", 2)
	clk.advance(time.Second)
	c.Set("c", 3)
	if _, st := c.Get("a"); st != Miss {
		t.Fatalf("oldest entry should be evicted, got %v", st)
	}
	if _, st := c.Get("c"); st != Fresh {
		t.Fatalf("newest entry should remain, got %v", st)
	}
}
