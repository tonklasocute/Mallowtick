package supportresistance

import (
	"cmp"
	"math"
	"math/rand/v2"
	"reflect"
	"slices"
	"testing"
	"time"
)

var t0 = time.Date(2026, 3, 2, 14, 30, 0, 0, time.UTC)

// series builds one candle per close with high/low = close ± 0.5.
func series(closes ...float64) []Candle {
	out := make([]Candle, len(closes))
	for i, c := range closes {
		out[i] = Candle{Time: t0.Add(time.Duration(i) * time.Hour), Open: c, High: c + 0.5, Low: c - 0.5, Close: c}
	}
	return out
}

// zigzag oscillates between 100 and 110 in steps of 2 for the given number of
// full cycles, then appends tail closes.
func zigzag(cycles int, tail ...float64) []Candle {
	var closes []float64
	for range cycles {
		for p := 100.0; p < 110; p += 2 {
			closes = append(closes, p)
		}
		for p := 110.0; p > 100; p -= 2 {
			closes = append(closes, p)
		}
	}
	closes = append(closes, 100)
	closes = append(closes, tail...)
	return series(closes...)
}

func mustCompute(t *testing.T, candles []Candle, cfg Config) Result {
	t.Helper()
	res, err := Compute(candles, cfg)
	if err != nil {
		t.Fatalf("Compute: %v", err)
	}
	return res
}

func levelsOf(res Result, kind Kind) []Level {
	var out []Level
	for _, l := range res.Levels {
		if l.Type == kind {
			out = append(out, l)
		}
	}
	return out
}

func TestZigzagFindsRangeBounds(t *testing.T) {
	res := mustCompute(t, zigzag(3, 102, 104, 105), DefaultConfig())

	if res.Status != StatusOK {
		t.Fatalf("status = %s", res.Status)
	}
	if res.ReferencePrice != 105 {
		t.Fatalf("reference = %v, want last close 105", res.ReferencePrice)
	}
	res1 := levelsOf(res, Resistance)
	sup := levelsOf(res, Support)
	if len(res1) != 1 || len(sup) != 1 {
		t.Fatalf("got %d resistance / %d support levels, want 1/1: %+v", len(res1), len(sup), res.Levels)
	}
	if res1[0].Price != 110.5 || res1[0].Touches != 3 {
		t.Errorf("resistance = %+v, want price 110.5 with 3 touches", res1[0])
	}
	if sup[0].Price != 99.5 || sup[0].Touches != 3 {
		t.Errorf("support = %+v, want price 99.5 with 3 touches", sup[0])
	}
	for _, l := range res.Levels {
		if l.Strength <= 0 || l.Strength > 1 {
			t.Errorf("strength %v out of (0,1]", l.Strength)
		}
		if l.ZoneLow > l.Price || l.ZoneHigh < l.Price {
			t.Errorf("price %v outside zone [%v, %v]", l.Price, l.ZoneLow, l.ZoneHigh)
		}
	}
	if !slices.IsSortedFunc(res.Levels, func(a, b Level) int { return cmp.Compare(b.Price, a.Price) }) {
		t.Errorf("levels not sorted by price descending: %+v", res.Levels)
	}
}

func TestInsufficientCandles(t *testing.T) {
	cfg := DefaultConfig()
	res := mustCompute(t, series(100, 101, 102, 101, 100, 99), cfg) // 6 < 2*3+1
	if res.Status != StatusInsufficientData {
		t.Fatalf("status = %s, want insufficient_data", res.Status)
	}
	if len(res.Levels) != 0 {
		t.Fatalf("expected no levels, got %+v", res.Levels)
	}
	if res.CandlesUsed != 6 {
		t.Fatalf("candles used = %d", res.CandlesUsed)
	}

	empty := mustCompute(t, nil, cfg)
	if empty.Status != StatusInsufficientData || empty.Levels == nil {
		t.Fatalf("empty input: %+v (levels must be an empty slice, not nil)", empty)
	}
}

func TestFlatMarketHasNoLevels(t *testing.T) {
	closes := make([]float64, 40)
	for i := range closes {
		closes[i] = 50
	}
	res := mustCompute(t, series(closes...), DefaultConfig())
	if res.Status != StatusOK || len(res.Levels) != 0 || res.SwingHighs != 0 || res.SwingLows != 0 {
		t.Fatalf("flat market should produce no swings or levels: %+v", res)
	}
	if res.Tolerance <= 0 {
		t.Fatalf("tolerance should fall back to the price floor, got %v", res.Tolerance)
	}
}

func TestDuplicatePivotPricesMergeIntoOneLevel(t *testing.T) {
	// Two identical peaks at 120.5 separated by a trough.
	res := mustCompute(t, series(110, 112, 114, 120, 114, 112, 110, 112, 114, 120, 114, 112, 110, 111), DefaultConfig())
	res1 := levelsOf(res, Resistance)
	if len(res1) != 1 {
		t.Fatalf("want one merged resistance, got %+v", res1)
	}
	if res1[0].Touches != 2 || res1[0].ZoneLow != res1[0].ZoneHigh {
		t.Fatalf("merged level = %+v, want 2 touches with zero-width zone", res1[0])
	}
}

func TestUnconfirmedSwingAtEndIsIgnored(t *testing.T) {
	// The highest high is two bars from the end; with SwingWindow=3 it cannot
	// be confirmed without future candles, so it must not become a level.
	candles := zigzag(2, 104, 108, 130, 126, 125)
	res := mustCompute(t, candles, DefaultConfig())
	for _, l := range res.Levels {
		if l.ZoneHigh >= 130 {
			t.Fatalf("level %+v uses an unconfirmed swing", l)
		}
	}
	if res.AsOf != candles[len(candles)-1].Time {
		t.Fatalf("asOf = %v, want last candle time", res.AsOf)
	}
}

func TestPrefixResultIgnoresLaterCandles(t *testing.T) {
	full := zigzag(3, 102, 104, 105)
	cut := 22
	prefix := mustCompute(t, full[:cut], DefaultConfig())
	for _, l := range prefix.Levels {
		if !l.LastTouchAt.Before(full[cut].Time) {
			t.Fatalf("level %+v references a candle at or after index %d", l, cut)
		}
	}
}

func TestGapsAreReflectedInATR(t *testing.T) {
	// Range 100–110, then a gap up to a new range 130–140.
	closes := []float64{100, 102, 104, 106, 108, 110, 108, 106, 104, 102, 100}
	for p := 130.0; p <= 140; p += 2 {
		closes = append(closes, p)
	}
	for p := 138.0; p >= 130; p -= 2 {
		closes = append(closes, p)
	}
	closes = append(closes, 132, 134)
	res := mustCompute(t, series(closes...), DefaultConfig())

	if res.ATR <= 1 {
		t.Fatalf("ATR %v should include the gap's true range", res.ATR)
	}
	if len(levelsOf(res, Resistance)) == 0 || len(levelsOf(res, Support)) == 0 {
		t.Fatalf("expected levels on both sides after a gap: %+v", res.Levels)
	}
}

func TestInvalidCandlesAreDropped(t *testing.T) {
	candles := zigzag(3, 102, 104, 105)
	bad := []Candle{
		{Time: t0.Add(-time.Hour), Open: math.NaN(), High: 1, Low: 1, Close: 1},
		{Time: t0.Add(-2 * time.Hour), Open: 1, High: 0.5, Low: 1, Close: 1}, // high < low
		{Time: t0.Add(-3 * time.Hour), Open: 0, High: 0, Low: 0, Close: 0},
		{Open: 100, High: 101, Low: 99, Close: 100}, // zero time
		candles[5], // duplicate timestamp
	}
	res := mustCompute(t, append(slices.Clone(candles), bad...), DefaultConfig())
	if res.CandlesDropped != len(bad) || res.CandlesUsed != len(candles) {
		t.Fatalf("dropped=%d used=%d, want %d/%d", res.CandlesDropped, res.CandlesUsed, len(bad), len(candles))
	}
	clean := mustCompute(t, candles, DefaultConfig())
	if !reflect.DeepEqual(res.Levels, clean.Levels) {
		t.Fatalf("invalid candles changed the levels:\n got %+v\nwant %+v", res.Levels, clean.Levels)
	}
}

func TestDeterministicRegardlessOfInputOrder(t *testing.T) {
	candles := zigzag(4, 101, 103)
	want := mustCompute(t, candles, DefaultConfig())
	shuffled := slices.Clone(candles)
	rand.New(rand.NewPCG(1, 2)).Shuffle(len(shuffled), func(i, j int) { shuffled[i], shuffled[j] = shuffled[j], shuffled[i] })
	got := mustCompute(t, shuffled, DefaultConfig())
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("result depends on input order:\n got %+v\nwant %+v", got, want)
	}
}

func TestMaxLevelsPerSide(t *testing.T) {
	// A staircase down creates several distinct swing lows below the last close.
	var closes []float64
	for base := 200.0; base > 100; base -= 20 {
		closes = append(closes, base, base-4, base-8, base-4, base, base+2)
	}
	closes = append(closes, 210, 212)
	cfg := DefaultConfig()
	cfg.MaxLevelsPerSide = 2
	res := mustCompute(t, series(closes...), cfg)
	if n := len(levelsOf(res, Support)); n != 2 {
		t.Fatalf("got %d supports, want 2: %+v", n, res.Levels)
	}
}

func TestInvalidConfig(t *testing.T) {
	cfg := DefaultConfig()
	cfg.SwingWindow = 0
	cfg.Weights = Weights{}
	if _, err := Compute(zigzag(2), cfg); err == nil {
		t.Fatal("expected a validation error")
	}
}
