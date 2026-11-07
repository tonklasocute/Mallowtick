// Package clientlimit keeps one client (an IP address, or an IPv6 /64) from
// taking more than its share of the API: a cap on requests, and a share of
// each vendor's budget that only provider calls spend from. These are token
// buckets, which is fine for fairness between clients; the vendors' own limits
// are still enforced exactly by ratebudget's sliding windows behind them.
package clientlimit

import (
	"net"
	"sync"
	"time"

	"github.com/tonklasocute/mallowtick/services/api/internal/market"
)

// Rate is a client's share of one vendor's budget. Zero means no limit.
type Rate struct {
	PerMinute int
	PerDay    int
}

// Config sets the limits per client. Zero means no limit.
type Config struct {
	RequestsPerMinute int
	// Vendors maps a provider name (e.g. "twelvedata") to a client's share.
	Vendors map[string]Rate
	Now     func() time.Time
}

// Limiter tracks every client's buckets. It is safe for concurrent use.
type Limiter struct {
	cfg       Config
	mu        sync.Mutex
	clients   map[string]*client
	lastPrune time.Time
}

type client struct {
	requests bucket
	minute   map[string]*bucket
	day      map[string]*bucket
}

// pruneEvery is how often clients whose buckets have all refilled are
// forgotten; a full bucket holds nothing worth keeping.
const pruneEvery = time.Minute

// New returns a limiter for cfg.
func New(cfg Config) *Limiter {
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	return &Limiter{cfg: cfg, clients: make(map[string]*client)}
}

// Key is the client a remote address counts as: the address itself for IPv4,
// its /64 for IPv6, where one home or phone gets a whole /64 to pick from.
func Key(ip string) string {
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return ip
	}
	if v4 := parsed.To4(); v4 != nil {
		return v4.String()
	}
	return parsed.Mask(net.CIDRMask(64, 128)).String() + "/64"
}

// Allow books one request for the client. When the client is over its limit
// it books nothing and returns how long until a request would be allowed.
func (l *Limiter) Allow(key string) (bool, time.Duration) {
	if l.cfg.RequestsPerMinute <= 0 {
		return true, 0
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.cfg.Now()
	l.pruneLocked(now)
	return l.clientLocked(key).requests.take(1, l.cfg.RequestsPerMinute, time.Minute, now)
}

// Allowance is the client's share of the vendors' budgets, for
// market.WithAllowance.
func (l *Limiter) Allowance(key string) market.Allowance {
	return allowance{l: l, key: key}
}

type allowance struct {
	l   *Limiter
	key string
}

// Take books units of vendor's budget when both the client's minute and day
// shares have room, and nothing otherwise.
func (a allowance) Take(vendor string, units int) bool {
	rate := a.l.cfg.Vendors[vendor]
	if rate.PerMinute <= 0 && rate.PerDay <= 0 {
		return true
	}
	a.l.mu.Lock()
	defer a.l.mu.Unlock()
	now := a.l.cfg.Now()
	a.l.pruneLocked(now)
	c := a.l.clientLocked(a.key)
	minute := vendorBucket(c.minute, vendor)
	day := vendorBucket(c.day, vendor)
	if !minute.has(units, rate.PerMinute, time.Minute, now) || !day.has(units, rate.PerDay, 24*time.Hour, now) {
		return false
	}
	minute.take(units, rate.PerMinute, time.Minute, now)
	day.take(units, rate.PerDay, 24*time.Hour, now)
	return true
}

func vendorBucket(m map[string]*bucket, vendor string) *bucket {
	b, ok := m[vendor]
	if !ok {
		b = &bucket{}
		m[vendor] = b
	}
	return b
}

func (l *Limiter) clientLocked(key string) *client {
	c, ok := l.clients[key]
	if !ok {
		c = &client{minute: make(map[string]*bucket), day: make(map[string]*bucket)}
		l.clients[key] = c
	}
	return c
}

func (l *Limiter) pruneLocked(now time.Time) {
	if now.Sub(l.lastPrune) < pruneEvery {
		return
	}
	l.lastPrune = now
	for key, c := range l.clients {
		if l.idle(c, now) {
			delete(l.clients, key)
		}
	}
}

// idle reports whether every bucket of c has refilled, so forgetting c changes
// nothing.
func (l *Limiter) idle(c *client, now time.Time) bool {
	if !c.requests.full(l.cfg.RequestsPerMinute, time.Minute, now) {
		return false
	}
	for vendor, b := range c.minute {
		if !b.full(l.cfg.Vendors[vendor].PerMinute, time.Minute, now) {
			return false
		}
	}
	for vendor, b := range c.day {
		if !b.full(l.cfg.Vendors[vendor].PerDay, 24*time.Hour, now) {
			return false
		}
	}
	return true
}

// bucket holds up to limit tokens and refills limit of them every period. A
// bucket never used counts as full. A limit of zero or less never runs out.
type bucket struct {
	used  bool
	level float64
	at    time.Time
}

func (b *bucket) tokens(limit int, period time.Duration, now time.Time) float64 {
	if !b.used {
		return float64(limit)
	}
	refill := now.Sub(b.at).Seconds() * float64(limit) / period.Seconds()
	return min(float64(limit), b.level+refill)
}

func (b *bucket) has(n, limit int, period time.Duration, now time.Time) bool {
	return limit <= 0 || b.tokens(limit, period, now) >= float64(n)
}

func (b *bucket) full(limit int, period time.Duration, now time.Time) bool {
	return limit <= 0 || b.tokens(limit, period, now) >= float64(limit)
}

// take removes n tokens when there are enough, or reports how long until
// there will be.
func (b *bucket) take(n, limit int, period time.Duration, now time.Time) (bool, time.Duration) {
	if limit <= 0 {
		return true, 0
	}
	have := b.tokens(limit, period, now)
	if have < float64(n) {
		missing := float64(n) - have
		return false, time.Duration(missing / float64(limit) * float64(period))
	}
	b.used, b.level, b.at = true, have-float64(n), now
	return true, 0
}
