// Package supportresistance derives support and resistance levels from OHLC
// candles using confirmed swing points clustered by a volatility-aware
// tolerance. The calculation is deterministic and only uses the candles it is
// given; levels are analytical estimates, not provider data or predictions.
//
// Method (v1):
//  1. Drop invalid candles, sort by time, de-duplicate timestamps.
//  2. Compute ATR (Wilder) as of the last candle.
//  3. Find swing highs/lows: a bar whose high (low) is strictly above (below)
//     the previous SwingWindow bars and not exceeded by the next SwingWindow
//     bars. Bars within SwingWindow of the end are unconfirmed and ignored, so
//     no level relies on candles after the input's last bar.
//  4. Cluster swing prices whose spread is within
//     max(ClusterATRMultiple×ATR, MinTolerancePct×reference price).
//  5. Score each cluster from touch count, recency of its last touch, and the
//     average reaction (move away from the swing within SwingWindow bars, in
//     ATR units), each normalized to [0,1] and weighted.
//  6. Classify clusters at or below the reference price (last close) as
//     support and above it as resistance; keep the strongest per side.
package supportresistance

import (
	"cmp"
	"errors"
	"fmt"
	"math"
	"slices"
	"time"
)

// Candle is the algorithm's input bar.
type Candle struct {
	Time  time.Time
	Open  float64
	High  float64
	Low   float64
	Close float64
}

// Weights balance the score components. They need not sum to one.
type Weights struct {
	Touches  float64 `json:"touches"`
	Recency  float64 `json:"recency"`
	Reaction float64 `json:"reaction"`
}

// Config controls the calculation.
type Config struct {
	SwingWindow        int     `json:"swingWindow"`
	ATRPeriod          int     `json:"atrPeriod"`
	ClusterATRMultiple float64 `json:"clusterAtrMultiple"`
	MinTolerancePct    float64 `json:"minTolerancePct"`
	MaxLevelsPerSide   int     `json:"maxLevelsPerSide"`
	// MaxTouchesForScore is the touch count at which the touch score saturates.
	MaxTouchesForScore int `json:"maxTouchesForScore"`
	// MaxReactionATR is the reaction (in ATRs) at which the reaction score saturates.
	MaxReactionATR float64 `json:"maxReactionAtr"`
	// RecencyHalfLife is the half-life of the recency score as a fraction of
	// the number of candles.
	RecencyHalfLife float64 `json:"recencyHalfLife"`
	Weights         Weights `json:"weights"`
}

// DefaultConfig returns the documented v1 parameters.
func DefaultConfig() Config {
	return Config{
		SwingWindow:        3,
		ATRPeriod:          14,
		ClusterATRMultiple: 0.5,
		MinTolerancePct:    0.001,
		MaxLevelsPerSide:   3,
		MaxTouchesForScore: 5,
		MaxReactionATR:     3,
		RecencyHalfLife:    0.25,
		Weights:            Weights{Touches: 0.4, Recency: 0.3, Reaction: 0.3},
	}
}

// Validate reports configuration errors.
func (c Config) Validate() error {
	var errs []error
	if c.SwingWindow < 1 {
		errs = append(errs, errors.New("swing window must be >= 1"))
	}
	if c.ATRPeriod < 1 {
		errs = append(errs, errors.New("ATR period must be >= 1"))
	}
	if c.ClusterATRMultiple < 0 {
		errs = append(errs, errors.New("cluster ATR multiple must be >= 0"))
	}
	if c.MinTolerancePct <= 0 {
		errs = append(errs, errors.New("minimum tolerance must be > 0"))
	}
	if c.MaxLevelsPerSide < 1 {
		errs = append(errs, errors.New("max levels per side must be >= 1"))
	}
	if c.MaxTouchesForScore < 1 {
		errs = append(errs, errors.New("max touches for score must be >= 1"))
	}
	if c.MaxReactionATR <= 0 {
		errs = append(errs, errors.New("max reaction must be > 0"))
	}
	if c.RecencyHalfLife <= 0 || c.RecencyHalfLife > 1 {
		errs = append(errs, errors.New("recency half-life must be in (0, 1]"))
	}
	w := c.Weights
	if w.Touches < 0 || w.Recency < 0 || w.Reaction < 0 || w.Touches+w.Recency+w.Reaction <= 0 {
		errs = append(errs, errors.New("weights must be >= 0 with a positive sum"))
	}
	return errors.Join(errs...)
}

// MinCandles is the fewest valid candles that can produce a confirmed swing.
func (c Config) MinCandles() int { return 2*c.SwingWindow + 1 }

// Kind is the role of a level relative to the reference price.
type Kind string

const (
	Support    Kind = "support"
	Resistance Kind = "resistance"
)

// Level is one support or resistance zone.
type Level struct {
	Type     Kind    `json:"type"`
	Price    float64 `json:"price"`
	ZoneLow  float64 `json:"zoneLow"`
	ZoneHigh float64 `json:"zoneHigh"`
	// Touches is the number of confirmed swing points in the cluster.
	Touches int `json:"touches"`
	// Strength is the weighted score in [0,1].
	Strength     float64   `json:"strength"`
	FirstTouchAt time.Time `json:"firstTouchAt"`
	LastTouchAt  time.Time `json:"lastTouchAt"`
}

// Status explains an empty result.
type Status string

const (
	StatusOK               Status = "ok"
	StatusInsufficientData Status = "insufficient_data"
)

// Result is the calculation output plus the metadata needed to explain it.
type Result struct {
	Status Status `json:"status"`
	// Levels are sorted by price, highest first.
	Levels         []Level   `json:"levels"`
	ReferencePrice float64   `json:"referencePrice"`
	ATR            float64   `json:"atr"`
	Tolerance      float64   `json:"tolerance"`
	CandlesUsed    int       `json:"candlesUsed"`
	CandlesDropped int       `json:"candlesDropped"`
	SwingHighs     int       `json:"swingHighs"`
	SwingLows      int       `json:"swingLows"`
	AsOf           time.Time `json:"asOf"`
}

type pivot struct {
	index    int
	price    float64
	reaction float64
}

// Compute derives levels from candles. It never mutates its input.
func Compute(candles []Candle, cfg Config) (Result, error) {
	if err := cfg.Validate(); err != nil {
		return Result{}, fmt.Errorf("supportresistance: %w", err)
	}

	bars, dropped := sanitize(candles)
	res := Result{Status: StatusOK, Levels: []Level{}, CandlesUsed: len(bars), CandlesDropped: dropped}
	if len(bars) > 0 {
		last := bars[len(bars)-1]
		res.AsOf = last.Time
		res.ReferencePrice = last.Close
	}
	if len(bars) < cfg.MinCandles() {
		res.Status = StatusInsufficientData
		return res, nil
	}

	atr := averageTrueRange(bars, cfg.ATRPeriod)
	tolerance := math.Max(cfg.ClusterATRMultiple*atr, cfg.MinTolerancePct*res.ReferencePrice)
	res.ATR = round(atr, 4)
	res.Tolerance = round(tolerance, 4)

	pivots, highs, lows := findPivots(bars, cfg.SwingWindow, atr)
	res.SwingHighs, res.SwingLows = highs, lows

	clusters := clusterPivots(pivots, tolerance)
	var supports, resistances []scoredLevel
	for _, cl := range clusters {
		sl := scoreCluster(cl, bars, cfg)
		if sl.Price <= res.ReferencePrice {
			sl.Type = Support
			supports = append(supports, sl)
		} else {
			sl.Type = Resistance
			resistances = append(resistances, sl)
		}
	}
	for _, side := range [][]scoredLevel{strongest(supports, cfg.MaxLevelsPerSide, res.ReferencePrice),
		strongest(resistances, cfg.MaxLevelsPerSide, res.ReferencePrice)} {
		for _, sl := range side {
			res.Levels = append(res.Levels, sl.Level)
		}
	}
	slices.SortFunc(res.Levels, func(a, b Level) int { return cmp.Compare(b.Price, a.Price) })
	return res, nil
}

func validCandle(c Candle) bool {
	for _, v := range []float64{c.Open, c.High, c.Low, c.Close} {
		if math.IsNaN(v) || math.IsInf(v, 0) || v <= 0 {
			return false
		}
	}
	return !c.Time.IsZero() && c.High >= c.Low
}

// sanitize drops invalid bars, orders by time, and keeps the last bar for any
// duplicated timestamp.
func sanitize(in []Candle) ([]Candle, int) {
	out := make([]Candle, 0, len(in))
	for _, c := range in {
		if validCandle(c) {
			out = append(out, c)
		}
	}
	slices.SortStableFunc(out, func(a, b Candle) int { return a.Time.Compare(b.Time) })
	deduped := out[:0]
	for i, c := range out {
		if i+1 < len(out) && out[i+1].Time.Equal(c.Time) {
			continue
		}
		deduped = append(deduped, c)
	}
	return deduped, len(in) - len(deduped)
}

// averageTrueRange returns Wilder's ATR as of the last bar. With fewer than
// period true ranges it falls back to their simple mean.
func averageTrueRange(bars []Candle, period int) float64 {
	trs := make([]float64, len(bars))
	for i, b := range bars {
		tr := b.High - b.Low
		if i > 0 {
			prev := bars[i-1].Close
			tr = math.Max(tr, math.Max(math.Abs(b.High-prev), math.Abs(b.Low-prev)))
		}
		trs[i] = tr
	}
	if len(trs) <= period {
		return mean(trs)
	}
	atr := mean(trs[:period])
	for _, tr := range trs[period:] {
		atr = (atr*float64(period-1) + tr) / float64(period)
	}
	return atr
}

func findPivots(bars []Candle, k int, atr float64) (pivots []pivot, highs, lows int) {
	for i := k; i+k < len(bars); i++ {
		if isSwingHigh(bars, i, k) {
			lowest := bars[i+1].Low
			for _, b := range bars[i+2 : i+k+1] {
				lowest = math.Min(lowest, b.Low)
			}
			pivots = append(pivots, pivot{index: i, price: bars[i].High, reaction: ratio(bars[i].High-lowest, atr)})
			highs++
		}
		if isSwingLow(bars, i, k) {
			highest := bars[i+1].High
			for _, b := range bars[i+2 : i+k+1] {
				highest = math.Max(highest, b.High)
			}
			pivots = append(pivots, pivot{index: i, price: bars[i].Low, reaction: ratio(highest-bars[i].Low, atr)})
			lows++
		}
	}
	return pivots, highs, lows
}

// isSwingHigh requires a strictly higher high than the k bars before and no
// higher high in the k bars after, so a plateau yields one pivot.
func isSwingHigh(bars []Candle, i, k int) bool {
	h := bars[i].High
	for j := i - k; j < i; j++ {
		if bars[j].High >= h {
			return false
		}
	}
	for j := i + 1; j <= i+k; j++ {
		if bars[j].High > h {
			return false
		}
	}
	return true
}

func isSwingLow(bars []Candle, i, k int) bool {
	l := bars[i].Low
	for j := i - k; j < i; j++ {
		if bars[j].Low <= l {
			return false
		}
	}
	for j := i + 1; j <= i+k; j++ {
		if bars[j].Low < l {
			return false
		}
	}
	return true
}

// clusterPivots groups pivots, sorted by price, so that each cluster's price
// spread is at most tolerance.
func clusterPivots(pivots []pivot, tolerance float64) [][]pivot {
	sorted := slices.Clone(pivots)
	slices.SortFunc(sorted, func(a, b pivot) int {
		return cmp.Or(cmp.Compare(a.price, b.price), cmp.Compare(a.index, b.index))
	})
	var clusters [][]pivot
	for _, p := range sorted {
		n := len(clusters)
		if n > 0 && p.price-clusters[n-1][0].price <= tolerance {
			clusters[n-1] = append(clusters[n-1], p)
			continue
		}
		clusters = append(clusters, []pivot{p})
	}
	return clusters
}

type scoredLevel struct {
	Level
	score float64
}

func scoreCluster(cl []pivot, bars []Candle, cfg Config) scoredLevel {
	prices := make([]float64, len(cl))
	reactions := make([]float64, len(cl))
	first, last := cl[0].index, cl[0].index
	for i, p := range cl {
		prices[i], reactions[i] = p.price, p.reaction
		first, last = min(first, p.index), max(last, p.index)
	}

	halfLife := math.Max(1, cfg.RecencyHalfLife*float64(len(bars)))
	barsSince := float64(len(bars) - 1 - last)
	recency := math.Exp(-math.Ln2 * barsSince / halfLife)
	touches := math.Min(float64(len(cl)), float64(cfg.MaxTouchesForScore)) / float64(cfg.MaxTouchesForScore)
	reaction := math.Min(mean(reactions), cfg.MaxReactionATR) / cfg.MaxReactionATR

	w := cfg.Weights
	score := (w.Touches*touches + w.Recency*recency + w.Reaction*reaction) / (w.Touches + w.Recency + w.Reaction)

	return scoredLevel{
		Level: Level{
			Price:        round(mean(prices), 4),
			ZoneLow:      round(slices.Min(prices), 4),
			ZoneHigh:     round(slices.Max(prices), 4),
			Touches:      len(cl),
			Strength:     round(score, 3),
			FirstTouchAt: bars[first].Time,
			LastTouchAt:  bars[last].Time,
		},
		score: score,
	}
}

// strongest keeps the n highest-scoring levels; ties prefer levels nearer the
// reference price, then lower prices, for a deterministic order.
func strongest(levels []scoredLevel, n int, ref float64) []scoredLevel {
	slices.SortFunc(levels, func(a, b scoredLevel) int {
		return cmp.Or(
			cmp.Compare(b.score, a.score),
			cmp.Compare(math.Abs(a.Price-ref), math.Abs(b.Price-ref)),
			cmp.Compare(a.Price, b.Price),
		)
	})
	return levels[:min(n, len(levels))]
}

func mean(xs []float64) float64 {
	if len(xs) == 0 {
		return 0
	}
	var sum float64
	for _, x := range xs {
		sum += x
	}
	return sum / float64(len(xs))
}

func ratio(a, b float64) float64 {
	if b <= 0 {
		return 0
	}
	return a / b
}

func round(x float64, places int) float64 {
	p := math.Pow10(places)
	return math.Round(x*p) / p
}
