// Package cache provides a small in-memory TTL cache that keeps expired
// entries for a while so callers can fall back to them when a refresh fails.
package cache

import (
	"cmp"
	"slices"
	"strings"
	"sync"
	"time"
)

// State describes a lookup result.
type State int

const (
	Miss  State = iota // no entry, or the entry is older than the retention window
	Fresh              // entry is within its TTL
	Stale              // entry expired but is still retained for fallback
)

// Entry is a cached value and when it was stored.
type Entry[V any] struct {
	Value    V
	StoredAt time.Time
}

// Item is an entry with its key and expiry, as Snapshot exports it for Restore.
type Item[V any] struct {
	Key       string    `json:"key"`
	Value     V         `json:"value"`
	StoredAt  time.Time `json:"storedAt"`
	ExpiresAt time.Time `json:"expiresAt"`
}

type slot[V any] struct {
	Entry[V]
	expiresAt time.Time
}

// TTL is a concurrency-safe cache keyed by string.
type TTL[V any] struct {
	mu         sync.Mutex
	items      map[string]slot[V]
	ttl        time.Duration
	retain     time.Duration
	maxEntries int
	now        func() time.Time
}

// New creates a cache whose entries are fresh for ttl and retained for
// fallback until retain has passed since they were stored. When maxEntries is
// exceeded the oldest entry is evicted.
func New[V any](ttl, retain time.Duration, maxEntries int, now func() time.Time) *TTL[V] {
	if now == nil {
		now = time.Now
	}
	if retain < ttl {
		retain = ttl
	}
	return &TTL[V]{
		items:      make(map[string]slot[V]),
		ttl:        ttl,
		retain:     retain,
		maxEntries: maxEntries,
		now:        now,
	}
}

// Get returns the entry for key and its state.
func (c *TTL[V]) Get(key string) (Entry[V], State) {
	c.mu.Lock()
	defer c.mu.Unlock()
	it, ok := c.items[key]
	if !ok {
		return Entry[V]{}, Miss
	}
	now := c.now()
	if now.Sub(it.StoredAt) > c.retain {
		delete(c.items, key)
		return Entry[V]{}, Miss
	}
	if now.Before(it.expiresAt) {
		return it.Entry, Fresh
	}
	return it.Entry, Stale
}

// Set stores value with the cache's default TTL.
func (c *TTL[V]) Set(key string, value V) Entry[V] {
	return c.SetWithTTL(key, value, c.ttl)
}

// SetWithTTL stores value with a specific TTL (capped by the retention window).
func (c *TTL[V]) SetWithTTL(key string, value V, ttl time.Duration) Entry[V] {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := c.now()
	if ttl > c.retain {
		ttl = c.retain
	}
	e := Entry[V]{Value: value, StoredAt: now}
	c.items[key] = slot[V]{Entry: e, expiresAt: now.Add(ttl)}
	if c.maxEntries > 0 && len(c.items) > c.maxEntries {
		c.evictOldestLocked()
	}
	return e
}

// Snapshot returns the entries still within the retention window, oldest
// first, so they can be saved and restored after a restart. Values are shared
// with the cache, not copied.
func (c *TTL[V]) Snapshot() []Item[V] {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := c.now()
	out := make([]Item[V], 0, len(c.items))
	for k, s := range c.items {
		if now.Sub(s.StoredAt) > c.retain {
			continue
		}
		out = append(out, Item[V]{Key: k, Value: s.Value, StoredAt: s.StoredAt, ExpiresAt: s.expiresAt})
	}
	slices.SortFunc(out, func(a, b Item[V]) int {
		return cmp.Or(a.StoredAt.Compare(b.StoredAt), strings.Compare(a.Key, b.Key))
	})
	return out
}

// Restore puts back entries from Snapshot with their original times, so each
// is Fresh, Stale or Miss just as it would have been without a restart.
// Entries past retention are skipped, and an entry already cached that was
// stored later is kept. It returns how many entries it stored.
func (c *TTL[V]) Restore(items []Item[V]) int {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := c.now()
	n := 0
	for _, it := range items {
		if now.Sub(it.StoredAt) > c.retain {
			continue
		}
		if cur, ok := c.items[it.Key]; ok && !it.StoredAt.After(cur.StoredAt) {
			continue
		}
		expiresAt := it.ExpiresAt
		if limit := it.StoredAt.Add(c.retain); expiresAt.After(limit) {
			expiresAt = limit // as SetWithTTL caps the TTL
		}
		c.items[it.Key] = slot[V]{Entry: Entry[V]{Value: it.Value, StoredAt: it.StoredAt}, expiresAt: expiresAt}
		n++
		if c.maxEntries > 0 && len(c.items) > c.maxEntries {
			c.evictOldestLocked()
		}
	}
	return n
}

func (c *TTL[V]) evictOldestLocked() {
	var oldestKey string
	var oldest time.Time
	first := true
	for k, it := range c.items {
		if first || it.StoredAt.Before(oldest) {
			oldestKey, oldest, first = k, it.StoredAt, false
		}
	}
	delete(c.items, oldestKey)
}
