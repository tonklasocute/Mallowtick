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

func TestSnapshotRestoreKeepsTimes(t *testing.T) {
	clk := &clock{t: time.Date(2026, 1, 2, 15, 0, 0, 0, time.UTC)}
	c := New[int](time.Minute, time.Hour, 0, clk.now)
	c.Set("gone", 0)
	clk.advance(2 * time.Hour)
	c.Set("stale", 1)
	clk.advance(30 * time.Second)
	c.SetWithTTL("fresh", 2, 10*time.Minute)
	clk.advance(time.Minute)

	snap := c.Snapshot()
	if len(snap) != 2 || snap[0].Key != "stale" || snap[1].Key != "fresh" {
		t.Fatalf("snapshot should hold retained entries oldest first, got %+v", snap)
	}

	restored := New[int](time.Minute, time.Hour, 0, clk.now)
	if n := restored.Restore(snap); n != 2 {
		t.Fatalf("restored %d entries, want 2", n)
	}
	if e, st := restored.Get("stale"); st != Stale || e.Value != 1 || !e.StoredAt.Equal(snap[0].StoredAt) {
		t.Fatalf("stale: got %v/%+v", st, e)
	}
	if e, st := restored.Get("fresh"); st != Fresh || e.Value != 2 || !e.StoredAt.Equal(snap[1].StoredAt) {
		t.Fatalf("fresh: got %v/%+v", st, e)
	}
	clk.advance(9 * time.Minute) // the fresh entry's own TTL has now run out
	if _, st := restored.Get("fresh"); st != Stale {
		t.Fatalf("restored entry should expire at its original time, got %v", st)
	}
}

func TestRestoreSkipsEntriesPastRetention(t *testing.T) {
	clk := &clock{t: time.Unix(0, 0)}
	c := New[int](time.Minute, time.Hour, 0, clk.now)
	old := clk.t.Add(-2 * time.Hour)
	if n := c.Restore([]Item[int]{{Key: "a", Value: 1, StoredAt: old, ExpiresAt: old.Add(time.Minute)}}); n != 0 {
		t.Fatalf("restored %d entries, want 0", n)
	}
	if _, st := c.Get("a"); st != Miss {
		t.Fatalf("got %v, want Miss", st)
	}
}

func TestRestoreCapsExpiryAtRetention(t *testing.T) {
	clk := &clock{t: time.Unix(0, 0)}
	c := New[int](time.Minute, time.Hour, 0, clk.now)
	c.Restore([]Item[int]{{Key: "a", Value: 1, StoredAt: clk.t, ExpiresAt: clk.t.Add(10 * time.Hour)}})
	clk.advance(time.Hour)
	if _, st := c.Get("a"); st != Stale {
		t.Fatalf("expiry should be capped at the retention window, got %v", st)
	}
}

func TestRestoreKeepsNewerEntries(t *testing.T) {
	clk := &clock{t: time.Unix(0, 0)}
	c := New[int](time.Minute, time.Hour, 0, clk.now)
	older := clk.t
	clk.advance(time.Second)
	c.Set("a", 2)
	c.Set("b", 2)
	clk.advance(time.Second)
	newer := clk.t
	n := c.Restore([]Item[int]{
		{Key: "a", Value: 1, StoredAt: older, ExpiresAt: older.Add(time.Minute)},
		{Key: "b", Value: 3, StoredAt: newer, ExpiresAt: newer.Add(time.Minute)},
	})
	if n != 1 {
		t.Fatalf("restored %d entries, want 1", n)
	}
	if e, _ := c.Get("a"); e.Value != 2 {
		t.Fatalf("an entry stored later must not be overwritten, got %d", e.Value)
	}
	if e, _ := c.Get("b"); e.Value != 3 {
		t.Fatalf("an older entry should be replaced, got %d", e.Value)
	}
}

func TestRestoreEvictsOldestWhenFull(t *testing.T) {
	clk := &clock{t: time.Unix(0, 0)}
	c := New[int](time.Minute, time.Hour, 2, clk.now)
	at := func(sec int) time.Time { return clk.t.Add(time.Duration(sec) * time.Second) }
	items := []Item[int]{
		{Key: "b", Value: 2, StoredAt: at(1), ExpiresAt: at(61)},
		{Key: "a", Value: 1, StoredAt: at(0), ExpiresAt: at(60)},
		{Key: "c", Value: 3, StoredAt: at(2), ExpiresAt: at(62)},
	}
	clk.advance(3 * time.Second)
	c.Restore(items)
	if _, st := c.Get("a"); st != Miss {
		t.Fatalf("oldest entry should be evicted, got %v", st)
	}
	if _, st := c.Get("b"); st != Fresh {
		t.Fatalf("b should remain, got %v", st)
	}
	if _, st := c.Get("c"); st != Fresh {
		t.Fatalf("c should remain, got %v", st)
	}
}
