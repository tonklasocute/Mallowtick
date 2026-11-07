package clientlimit

import (
	"testing"
	"time"
)

type clock struct{ t time.Time }

func (c *clock) now() time.Time          { return c.t }
func (c *clock) advance(d time.Duration) { c.t = c.t.Add(d) }

func newClock() *clock { return &clock{t: time.Date(2026, 11, 9, 15, 0, 0, 0, time.UTC)} }

func TestKey(t *testing.T) {
	cases := map[string]string{
		"203.0.113.7":                 "203.0.113.7",
		"::ffff:203.0.113.7":          "203.0.113.7",
		"2001:db8:1:2:aaaa:bbbb:cc:d": "2001:db8:1:2::/64",
		"2001:db8:1:2::9":             "2001:db8:1:2::/64",
		"not an ip":                   "not an ip",
	}
	for in, want := range cases {
		if got := Key(in); got != want {
			t.Errorf("Key(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestRequestsRefillOverTheMinute(t *testing.T) {
	clk := newClock()
	l := New(Config{RequestsPerMinute: 60, Now: clk.now})
	for i := range 60 {
		if ok, _ := l.Allow("a"); !ok {
			t.Fatalf("request %d should fit the first minute's 60", i+1)
		}
	}
	ok, wait := l.Allow("a")
	if ok || wait != time.Second {
		t.Fatalf("61st request: ok=%v wait=%v, want refused with 1s", ok, wait)
	}
	if ok, _ := l.Allow("b"); !ok {
		t.Fatal("another client has its own limit")
	}
	clk.advance(time.Second)
	if ok, _ := l.Allow("a"); !ok {
		t.Fatal("one request should have refilled after a second")
	}
}

func TestZeroMeansNoLimit(t *testing.T) {
	l := New(Config{Now: newClock().now})
	for range 1000 {
		if ok, _ := l.Allow("a"); !ok {
			t.Fatal("no request limit configured")
		}
	}
	if !l.Allowance("a").Take("twelvedata", 100) {
		t.Fatal("a vendor without a share must not be limited")
	}
}

func TestVendorShareNeedsRoomInBothMinuteAndDay(t *testing.T) {
	clk := newClock()
	l := New(Config{Now: clk.now, Vendors: map[string]Rate{
		"finnhub":    {PerMinute: 3},
		"twelvedata": {PerDay: 5},
	}})
	a := l.Allowance("a")

	for i := range 3 {
		if !a.Take("finnhub", 1) {
			t.Fatalf("finnhub call %d should fit", i+1)
		}
	}
	if a.Take("finnhub", 1) {
		t.Fatal("the 4th finnhub call in a minute is over the share")
	}
	if !l.Allowance("b").Take("finnhub", 1) {
		t.Fatal("another client has its own share")
	}
	clk.advance(20 * time.Second)
	if !a.Take("finnhub", 1) {
		t.Fatal("one call refills every 20 seconds")
	}

	if !a.Take("twelvedata", 4) {
		t.Fatal("4 of 5 daily credits should fit")
	}
	if a.Take("twelvedata", 2) {
		t.Fatal("2 credits don't fit the 1 left")
	}
	if !a.Take("twelvedata", 1) {
		t.Fatal("a refused take must book nothing, so 1 credit still fits")
	}
	clk.advance(time.Hour)
	if a.Take("twelvedata", 1) {
		t.Fatal("an hour refills only 5/24 of a credit")
	}
	clk.advance(5 * time.Hour)
	if !a.Take("twelvedata", 1) {
		t.Fatal("about one credit should have refilled after 6 hours")
	}
}

func TestIdleClientsAreForgotten(t *testing.T) {
	clk := newClock()
	l := New(Config{RequestsPerMinute: 10, Now: clk.now, Vendors: map[string]Rate{"twelvedata": {PerDay: 10}}})
	l.Allow("busy")
	l.Allowance("busy").Take("twelvedata", 1)
	l.Allow("light")
	clk.advance(2 * time.Minute)
	l.Allow("other") // prunes
	if _, ok := l.clients["light"]; ok {
		t.Error("a client whose buckets refilled should be forgotten")
	}
	if _, ok := l.clients["busy"]; !ok {
		t.Error("a client still owing part of its day share must be kept")
	}
}
