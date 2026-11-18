// Package research derives explainable observations ("insights") from market
// data the API already serves. Every insight is produced by a fixed rule from
// vendor-reported values, names its facts, sources, time and how complete the
// underlying data was, and makes no claim about causes. No insight is made
// when the data for its rule is missing or too short.
package research

import (
	"cmp"
	"fmt"
	"math"
	"slices"
	"strings"
	"time"

	"github.com/tonklasocute/mallowtick/services/api/internal/market"
)

// Rule thresholds. They are deliberately plain so each insight is easy to check.
const (
	// BigMovePercent is the day's move, either way, that is worth a note.
	BigMovePercent = 3.0
	// EMAPeriod is the moving average the price is compared with.
	EMAPeriod = 50
	// VolumeLookback sessions form the average volume; VolumeRatio is "unusual".
	VolumeLookback = 20
	VolumeRatio    = 1.5
	// EarningsSoonDays is how near a report must be.
	EarningsSoonDays = 7
	// RecentResultDays is how recent a reported quarter must be to mention.
	RecentResultDays = 30
	// NewsWindow is how recent news must be.
	NewsWindow = 24 * time.Hour
	// Near52WeekPercent is the distance from the 52-week high or low that counts as near.
	Near52WeekPercent = 2.0
	// sessionsPerYear is the 52-week window in daily bars.
	sessionsPerYear = 252
)

// Scope of an insight.
const (
	ScopeMarket = "market"
	ScopeSymbol = "symbol"
)

// Reliability says where an insight's facts come from: "high" when the vendor
// reported them as shown, "medium" when Mallowtick computed them from vendor
// data (averages, distances), so a vendor's data gap affects them more.
const (
	ReliabilityHigh   = "high"
	ReliabilityMedium = "medium"
)

// Completeness of the data behind an insight.
const (
	Complete = "complete"
	Partial  = "partial"
)

// Fact units, for the client to format values.
const (
	UnitUSD = "usd"
	// UnitAmount is money in the company's reporting currency: the earnings
	// vendor doesn't say which, and for foreign ADRs it is not USD (PDD, BIDU).
	UnitAmount  = "amount"
	UnitPercent = "percent"
	UnitShares  = "shares"
	UnitRatio   = "ratio"
	UnitDate    = "date"
	UnitText    = "text"
	UnitCount   = "count"
)

// Fact is one value an insight rests on.
type Fact struct {
	Label string `json:"label"`
	// Value is set for numbers; Text for dates and words.
	Value *float64 `json:"value"`
	Text  string   `json:"text,omitempty"`
	Unit  string   `json:"unit"`
}

func num(label string, v float64, unit string) Fact { return Fact{Label: label, Value: &v, Unit: unit} }
func text(label, t, unit string) Fact               { return Fact{Label: label, Text: t, Unit: unit} }

// Insight is one explainable observation.
type Insight struct {
	ID     string `json:"id"`
	Type   string `json:"type"`
	Scope  string `json:"scope"`
	Symbol string `json:"symbol,omitempty"`
	// Title and Explanation are Thai, shown as they are.
	Title       string `json:"title"`
	Explanation string `json:"explanation"`
	// Method says which rule produced it.
	Method string `json:"method"`
	Facts  []Fact `json:"facts"`
	// Sources are the vendors whose data was used, plus "mallowtick" when a
	// value was computed here.
	Sources      []string   `json:"sources"`
	AsOf         *time.Time `json:"asOf"`
	Completeness string     `json:"completeness"`
	Reliability  string     `json:"reliability"`
	// Tone is the direction of the facts (up, down, neutral), never advice.
	Tone string `json:"tone"`
	// Priority orders insights; higher first.
	Priority int `json:"priority"`
}

const computed = "mallowtick"

// SymbolData is what the rules see for one symbol. Any part may be missing.
type SymbolData struct {
	Symbol string
	Quote  *market.QuoteResult
	// Daily are the vendor's daily bars, oldest first, possibly including the
	// current session; DailySource names their vendor.
	Daily       []market.Candle
	DailySource string
	DailyAt     time.Time
	// NextEarnings is the next report not yet out; EarningsSource its vendor.
	NextEarnings   *market.EarningsEvent
	EarningsSource string
	// LastQuarter is the latest reported quarter with its result.
	LastQuarter  *market.EarningsQuarter
	ResultSource string
	// News are grouped stories about the symbol, newest first.
	News       []market.NewsArticle
	NewsSource string
}

// SymbolInsights applies every symbol rule. today is the New York date.
func SymbolInsights(d SymbolData, today string, now time.Time) []Insight {
	var out []Insight
	for _, rule := range []func(SymbolData, string, time.Time) *Insight{
		bigMove, belowEMA, unusualVolume, near52Week, earningsSoon, recentResult, recentNews,
	} {
		if in := rule(d, today, now); in != nil {
			out = append(out, *in)
		}
	}
	return out
}

// usableQuote is the quote when it has a price and a time; it may be a stale
// fallback, which the insight using it must mark as partial.
func usableQuote(d SymbolData) *market.QuoteResult {
	if d.Quote == nil || d.Quote.Price <= 0 || d.Quote.AsOf == nil {
		return nil
	}
	return d.Quote
}

// freshQuote is the quote only when it is not a stale fallback: computed
// insights compare it with averages as "the latest price".
func freshQuote(d SymbolData) *market.QuoteResult {
	if q := usableQuote(d); q != nil && !q.Freshness.Stale {
		return q
	}
	return nil
}

func bigMove(d SymbolData, _ string, _ time.Time) *Insight {
	q := usableQuote(d)
	if q == nil || q.ChangePercent == nil || math.Abs(*q.ChangePercent) < BigMovePercent {
		return nil
	}
	pct := *q.ChangePercent
	dir, tone := "ขึ้น", "up"
	if pct < 0 {
		dir, tone = "ลง", "down"
	}
	facts := []Fact{num("ราคา", q.Price, UnitUSD), num("เปลี่ยนจากราคาปิดก่อนหน้า", pct, UnitPercent)}
	if q.PreviousClose != nil {
		facts = append(facts, num("ราคาปิดก่อนหน้า", *q.PreviousClose, UnitUSD))
	}
	state := "ระหว่างวัน"
	if q.IsMarketOpen != nil && !*q.IsMarketOpen {
		state = "ณ ราคาล่าสุดก่อนตลาดปิด"
	}
	return &Insight{
		ID: id("big_move", d.Symbol, *q.AsOf), Type: "big_move", Scope: ScopeSymbol, Symbol: d.Symbol,
		Title:       fmt.Sprintf("%s ราคา%s %+.2f%%", d.Symbol, dir, pct),
		Explanation: fmt.Sprintf("ราคา%sเกิน %.0f%% จากราคาปิดวันก่อน %s ข้อสังเกตนี้บอกขนาดการเปลี่ยนแปลงเท่านั้น ไม่ได้บอกสาเหตุ", dir, BigMovePercent, state),
		Method:      fmt.Sprintf("การเปลี่ยนแปลงของราคาเทียบราคาปิดก่อนหน้า ตั้งแต่ %.0f%% ขึ้นไป", BigMovePercent),
		Facts:       facts, Sources: []string{q.Freshness.Provider}, AsOf: q.AsOf,
		Completeness: completeness(!q.Freshness.Stale), Reliability: ReliabilityHigh, Tone: tone,
		Priority: 70 + int(math.Min(math.Abs(pct), 20)),
	}
}

// completedBars are the daily bars before today's New York date: a session
// still running (or its bar right after the close) is never averaged in.
func completedBars(daily []market.Candle, today string) []market.Candle {
	ny, err := time.LoadLocation("America/New_York")
	if err != nil {
		ny = time.FixedZone("EST", -5*60*60)
	}
	end := len(daily)
	for end > 0 && daily[end-1].Time.In(ny).Format(time.DateOnly) >= today {
		end--
	}
	return daily[:end]
}

// EMA returns the exponential moving average of values over period, seeded
// with the simple average of the first period values, one value per input
// from index period-1 on (earlier entries are NaN).
func EMA(values []float64, period int) []float64 {
	out := make([]float64, len(values))
	for i := range out {
		out[i] = math.NaN()
	}
	if period < 1 || len(values) < period {
		return out
	}
	sum := 0.0
	for _, v := range values[:period] {
		sum += v
	}
	out[period-1] = sum / float64(period)
	k := 2 / float64(period+1)
	for i := period; i < len(values); i++ {
		out[i] = values[i]*k + out[i-1]*(1-k)
	}
	return out
}

func belowEMA(d SymbolData, today string, _ time.Time) *Insight {
	bars := completedBars(d.Daily, today)
	// Twice the period so the average has settled from its starting value.
	if len(bars) < 2*EMAPeriod {
		return nil
	}
	closes := make([]float64, len(bars))
	for i, b := range bars {
		closes[i] = b.Close
	}
	ema := EMA(closes, EMAPeriod)
	last := ema[len(ema)-1]
	price, priceLabel, asOf := closes[len(closes)-1], "ราคาปิดล่าสุด", bars[len(bars)-1].Time
	sources := []string{d.DailySource, computed}
	if q := freshQuote(d); q != nil {
		price, priceLabel, asOf = q.Price, "ราคาล่าสุด", *q.AsOf
		sources = []string{d.DailySource, q.Freshness.Provider, computed}
	}
	if price >= last {
		return nil
	}
	sessions := 0
	for i := len(closes) - 1; i >= 0 && !math.IsNaN(ema[i]) && closes[i] < ema[i]; i-- {
		sessions++
	}
	gap := (price - last) / last * 100
	return &Insight{
		ID: id("below_ema50", d.Symbol, asOf), Type: "below_ema50", Scope: ScopeSymbol, Symbol: d.Symbol,
		Title:       fmt.Sprintf("%s ต่ำกว่าเส้น EMA %d วัน", d.Symbol, EMAPeriod),
		Explanation: fmt.Sprintf("%s ต่ำกว่าค่าเฉลี่ยเคลื่อนที่แบบเอ็กซ์โปเนนเชียล %d วันของราคาปิด %.1f%% เป็นการเทียบตัวเลขเท่านั้น ไม่ใช่สัญญาณซื้อขาย", priceLabel, EMAPeriod, math.Abs(gap)),
		Method:      fmt.Sprintf("EMA %d วันจากราคาปิดรายวันที่จบเซสชันแล้ว %d วัน เทียบกับราคาล่าสุด", EMAPeriod, len(bars)),
		Facts: []Fact{
			num(priceLabel, price, UnitUSD), num(fmt.Sprintf("EMA %d วัน", EMAPeriod), last, UnitUSD),
			num("ห่างจากเส้น", gap, UnitPercent), num("ราคาปิดต่ำกว่าเส้นติดต่อกัน (วัน)", float64(sessions), UnitCount),
		},
		Sources: dedupe(sources), AsOf: &asOf, Completeness: Complete, Reliability: ReliabilityMedium,
		Tone: "down", Priority: 45,
	}
}

func unusualVolume(d SymbolData, today string, _ time.Time) *Insight {
	bars := completedBars(d.Daily, today)
	if len(bars) < VolumeLookback+1 {
		return nil
	}
	last := bars[len(bars)-1]
	window := bars[len(bars)-1-VolumeLookback : len(bars)-1]
	if last.Volume == nil {
		return nil
	}
	total := 0.0
	for _, b := range window {
		if b.Volume == nil {
			return nil // a gap in the vendor's volumes: no average
		}
		total += float64(*b.Volume)
	}
	avg := total / VolumeLookback
	if avg <= 0 {
		return nil
	}
	ratio := float64(*last.Volume) / avg
	if ratio < VolumeRatio {
		return nil
	}
	day := last.Time.Format(time.DateOnly)
	t := last.Time
	return &Insight{
		ID: id("unusual_volume", d.Symbol, t), Type: "unusual_volume", Scope: ScopeSymbol, Symbol: d.Symbol,
		Title:       fmt.Sprintf("%s ปริมาณซื้อขาย %.1f เท่าของค่าเฉลี่ย", d.Symbol, ratio),
		Explanation: fmt.Sprintf("ปริมาณซื้อขายของเซสชันล่าสุดที่จบแล้วสูงกว่าค่าเฉลี่ย %d เซสชันก่อนหน้า %.1f เท่า ไม่ได้บอกว่าเป็นแรงซื้อหรือแรงขาย", VolumeLookback, ratio),
		Method:      fmt.Sprintf("ปริมาณของเซสชันล่าสุดที่จบแล้ว เทียบค่าเฉลี่ย %d เซสชันก่อนหน้า ตั้งแต่ %.1f เท่า (ไม่รวมเซสชันวันนี้)", VolumeLookback, VolumeRatio),
		Facts: []Fact{
			text("เซสชัน", day, UnitDate), num("ปริมาณซื้อขาย", float64(*last.Volume), UnitShares),
			num(fmt.Sprintf("เฉลี่ย %d เซสชัน", VolumeLookback), avg, UnitShares), num("เท่าของค่าเฉลี่ย", ratio, UnitRatio),
		},
		Sources: []string{d.DailySource, computed}, AsOf: &t, Completeness: Complete, Reliability: ReliabilityMedium,
		Tone: "neutral", Priority: 50 + int(math.Min(ratio*5, 20)),
	}
}

func near52Week(d SymbolData, today string, _ time.Time) *Insight {
	bars := completedBars(d.Daily, today)
	if len(bars) < sessionsPerYear {
		return nil
	}
	year := bars[len(bars)-sessionsPerYear:]
	hi, lo := year[0].High, year[0].Low
	for _, b := range year {
		hi, lo = math.Max(hi, b.High), math.Min(lo, b.Low)
	}
	price, asOf, sources := bars[len(bars)-1].Close, bars[len(bars)-1].Time, []string{d.DailySource, computed}
	if q := freshQuote(d); q != nil {
		price, asOf, sources = q.Price, *q.AsOf, []string{d.DailySource, q.Freshness.Provider, computed}
	}
	fromHigh, fromLow := (hi-price)/hi*100, (price-lo)/lo*100
	var typ, title, tone string
	switch {
	case fromHigh <= Near52WeekPercent:
		typ, title, tone = "near_52w_high", fmt.Sprintf("%s ใกล้จุดสูงสุดรอบ 52 สัปดาห์", d.Symbol), "up"
	case fromLow <= Near52WeekPercent:
		typ, title, tone = "near_52w_low", fmt.Sprintf("%s ใกล้จุดต่ำสุดรอบ 52 สัปดาห์", d.Symbol), "down"
	default:
		return nil
	}
	return &Insight{
		ID: id(typ, d.Symbol, asOf), Type: typ, Scope: ScopeSymbol, Symbol: d.Symbol, Title: title,
		Explanation: fmt.Sprintf("ราคาอยู่ห่างจากราคา%sของ 252 เซสชันที่ผ่านมาไม่เกิน %.0f%%", map[string]string{"near_52w_high": "สูงสุด", "near_52w_low": "ต่ำสุด"}[typ], Near52WeekPercent),
		Method:      "ราคาสูงสุดและต่ำสุดของแท่งรายวัน 252 เซสชันที่จบแล้ว เทียบกับราคาล่าสุด",
		Facts: []Fact{
			num("ราคา", price, UnitUSD), num("สูงสุด 52 สัปดาห์", hi, UnitUSD), num("ต่ำสุด 52 สัปดาห์", lo, UnitUSD),
		},
		Sources: dedupe(sources), AsOf: &asOf, Completeness: Complete, Reliability: ReliabilityMedium, Tone: tone, Priority: 40,
	}
}

func earningsSoon(d SymbolData, today string, _ time.Time) *Insight {
	ev := d.NextEarnings
	if ev == nil || ev.EPSActual != nil || ev.RevenueActual != nil || ev.Date < today {
		return nil
	}
	days := daysBetween(today, ev.Date)
	if days > EarningsSoonDays {
		return nil
	}
	when := fmt.Sprintf("อีก %d วัน", days)
	if days == 0 {
		when = "วันนี้"
	}
	facts := []Fact{text("วันประกาศ (เวลาสหรัฐฯ)", ev.Date, UnitDate), text("ช่วงเวลา", hourText(ev.Hour), UnitText)}
	if ev.EPSEstimate != nil {
		facts = append(facts, num("EPS คาด", *ev.EPSEstimate, UnitAmount))
	}
	if ev.RevenueEstimate != nil {
		facts = append(facts, num("รายได้คาด", *ev.RevenueEstimate, UnitAmount))
	}
	return &Insight{
		ID: "earnings_soon:" + d.Symbol + ":" + ev.Date, Type: "earnings_soon", Scope: ScopeSymbol, Symbol: d.Symbol,
		Title:       fmt.Sprintf("%s ประกาศงบ%s", d.Symbol, when),
		Explanation: "ตามปฏิทินประกาศงบของผู้ให้บริการ วันประกาศอาจเปลี่ยนได้ ราคามักผันผวนได้มากขึ้นช่วงประกาศงบ",
		Method:      fmt.Sprintf("รายงานถัดไปที่ยังไม่ประกาศภายใน %d วัน", EarningsSoonDays),
		Facts:       facts, Sources: []string{d.EarningsSource}, Completeness: completeness(ev.EPSEstimate != nil),
		Reliability: ReliabilityHigh, Tone: "neutral", Priority: 80 - days,
	}
}

func recentResult(d SymbolData, today string, _ time.Time) *Insight {
	q := d.LastQuarter
	if q == nil || q.ReportDate == "" || q.EPSResult == "" || daysBetween(q.ReportDate, today) > RecentResultDays {
		return nil
	}
	words := map[string]string{market.ResultBeat: "ดีกว่าคาด", market.ResultMiss: "ต่ำกว่าคาด", market.ResultInline: "ตรงตามคาด"}
	tone := map[string]string{market.ResultBeat: "up", market.ResultMiss: "down", market.ResultInline: "neutral"}[q.EPSResult]
	facts := []Fact{
		text("ไตรมาส (ปีบัญชี)", fmt.Sprintf("Q%d %d", q.Quarter, q.Year), UnitText), text("วันประกาศ", q.ReportDate, UnitDate),
		num("EPS จริง", *q.Actual, UnitAmount), num("EPS คาด", *q.Estimate, UnitAmount),
	}
	if q.SurprisePercent != nil {
		facts = append(facts, num("ต่างจากคาด", *q.SurprisePercent, UnitPercent))
	}
	complete := false
	if q.RevenueResult != "" && q.RevenueActual != nil && q.RevenueEstimate != nil {
		complete = true
		facts = append(facts, num("รายได้จริง", *q.RevenueActual, UnitAmount), num("รายได้คาด", *q.RevenueEstimate, UnitAmount))
	}
	explanation := fmt.Sprintf("EPS ไตรมาสล่าสุด%sประมาณการเฉลี่ยของนักวิเคราะห์", words[q.EPSResult])
	if complete {
		explanation += fmt.Sprintf(" ส่วนรายได้%s", words[q.RevenueResult])
	}
	return &Insight{
		ID: "earnings_result:" + d.Symbol + ":" + q.ReportDate, Type: "earnings_result", Scope: ScopeSymbol, Symbol: d.Symbol,
		Title:       fmt.Sprintf("%s EPS %s", d.Symbol, words[q.EPSResult]),
		Explanation: explanation, Method: fmt.Sprintf("ผลประกาศล่าสุดภายใน %d วัน เทียบประมาณการ (ไตรมาสตามปีบัญชี)", RecentResultDays),
		Facts: facts, Sources: []string{d.ResultSource}, Completeness: completeness(complete),
		Reliability: ReliabilityHigh, Tone: tone, Priority: 60,
	}
}

func recentNews(d SymbolData, _ string, now time.Time) *Insight {
	var recent []market.NewsArticle
	for _, a := range d.News {
		if now.Sub(a.PublishedAt) <= NewsWindow && a.PublishedAt.Before(now.Add(time.Minute)) {
			recent = append(recent, a)
		}
	}
	if len(recent) == 0 {
		return nil
	}
	lead := recent[0]
	publishers := map[string]bool{}
	for _, a := range recent {
		for _, s := range a.Sources {
			if s.Source != "" {
				publishers[s.Source] = true
			}
		}
	}
	names := make([]string, 0, len(publishers))
	for p := range publishers {
		names = append(names, p)
	}
	slices.Sort(names)
	t := lead.PublishedAt
	return &Insight{
		ID: "news:" + d.Symbol + ":" + lead.ID, Type: "news", Scope: ScopeSymbol, Symbol: d.Symbol,
		Title:       fmt.Sprintf("%s มีข่าวใหม่ %d ข่าวใน 24 ชั่วโมง", d.Symbol, len(recent)),
		Explanation: "รายชื่อข่าวจากผู้ให้บริการ การมีข่าวไม่ได้หมายความว่าข่าวนั้นเป็นสาเหตุของการเปลี่ยนแปลงราคา",
		Method:      "ข่าวที่เชื่อมกับหุ้นนี้ เผยแพร่ใน 24 ชั่วโมงที่ผ่านมา (ข่าวซ้ำจากหลายแหล่งนับเป็นหนึ่ง)",
		Facts: []Fact{
			num("จำนวนข่าว", float64(len(recent)), UnitCount), text("ข่าวล่าสุด", lead.Headline, UnitText),
			text("แหล่งข่าว", strings.Join(names, ", "), UnitText),
		},
		Sources: []string{d.NewsSource}, AsOf: &t, Completeness: Complete, Reliability: ReliabilityHigh,
		Tone: "neutral", Priority: 30 + min(len(recent), 10),
	}
}

// MarketData is what the market rules see.
type MarketData struct {
	Benchmarks      []market.QuoteResult
	Sectors         *market.SectorsResult
	BenchmarkLabels map[string]string
}

// MarketInsights describes the benchmark ETFs and the sectors' day.
func MarketInsights(m MarketData) []Insight {
	var out []Insight
	for i, q := range m.Benchmarks {
		if q.ChangePercent == nil || q.AsOf == nil {
			continue
		}
		pct := *q.ChangePercent
		label := cmp.Or(m.BenchmarkLabels[q.Symbol], q.Symbol)
		tone := "neutral"
		if pct > 0 {
			tone = "up"
		} else if pct < 0 {
			tone = "down"
		}
		out = append(out, Insight{
			ID: id("index_move", q.Symbol, *q.AsOf), Type: "index_move", Scope: ScopeMarket, Symbol: q.Symbol,
			Title:       fmt.Sprintf("%s %+.2f%%", label, pct),
			Explanation: fmt.Sprintf("%s เป็นกองทุน ETF ที่อ้างอิงดัชนี ไม่ใช่ค่าดัชนีเอง", q.Symbol),
			Method:      "การเปลี่ยนแปลงของราคา ETF เทียบราคาปิดก่อนหน้า",
			Facts:       []Fact{num("ราคา ETF", q.Price, UnitUSD), num("เปลี่ยนแปลง", pct, UnitPercent)},
			Sources:     []string{q.Freshness.Provider}, AsOf: q.AsOf, Completeness: completeness(!q.Freshness.Stale),
			// In the configured order (SPY, QQQ, DIA by default).
			Reliability: ReliabilityHigh, Tone: tone, Priority: 95 - min(i, 4),
		})
	}
	if s := m.Sectors; s != nil && len(s.Sectors) > 0 {
		type day struct {
			id  string
			pct float64
		}
		var days []day
		for _, sec := range s.Sectors {
			if sec.Returns.Day != nil {
				days = append(days, day{sec.Sector, *sec.Returns.Day})
			}
		}
		if len(days) >= 2 {
			up := 0
			for _, d := range days {
				if d.pct > 0 {
					up++
				}
			}
			slices.SortFunc(days, func(a, b day) int { return cmp.Compare(b.pct, a.pct) })
			best, worst := days[0], days[len(days)-1]
			out = append(out, Insight{
				ID: "sector_breadth:" + s.Freshness.FetchedAt.Format(time.RFC3339), Type: "sector_breadth", Scope: ScopeMarket,
				Title:       fmt.Sprintf("กลุ่มอุตสาหกรรมบวก %d จาก %d กลุ่ม", up, len(days)),
				Explanation: fmt.Sprintf("นับจาก ETF รายกลุ่มของ S&P 500 ที่มีข้อมูลวันนี้ กลุ่มที่ดีที่สุดคือ %s (%+.2f%%) และอ่อนที่สุดคือ %s (%+.2f%%)", SectorName(best.id), best.pct, SectorName(worst.id), worst.pct),
				Method:      "การเปลี่ยนแปลงวันนี้ของ SPDR Select Sector ETF ทั้ง 11 กลุ่ม",
				Facts: []Fact{
					num("กลุ่มที่บวก", float64(up), UnitCount), num("กลุ่มที่มีข้อมูล", float64(len(days)), UnitCount),
					num("ดีที่สุด: "+SectorName(best.id), best.pct, UnitPercent), num("อ่อนที่สุด: "+SectorName(worst.id), worst.pct, UnitPercent),
				},
				Sources: []string{s.Freshness.Provider}, AsOf: s.Freshness.AsOf, Completeness: completeness(len(days) == len(market.Sectors)),
				Reliability: ReliabilityHigh, Tone: "neutral", Priority: 85,
			})
		}
	}
	return out
}

// SectorName is the Thai name of a sector key.
func SectorName(key string) string {
	if n, ok := sectorNames[key]; ok {
		return n
	}
	return key
}

var sectorNames = map[string]string{
	"energy": "พลังงาน", "materials": "วัสดุ", "industrials": "อุตสาหกรรม",
	"consumer-discretionary": "สินค้าฟุ่มเฟือย", "consumer-staples": "สินค้าจำเป็น", "health-care": "การแพทย์",
	"financials": "การเงิน", "technology": "เทคโนโลยี", "communication-services": "สื่อสาร",
	"utilities": "สาธารณูปโภค", "real-estate": "อสังหาริมทรัพย์",
}

// Rank sorts insights by priority, then by symbol and type for a stable order.
func Rank(in []Insight) []Insight {
	out := slices.Clone(in)
	slices.SortStableFunc(out, func(a, b Insight) int {
		return cmp.Or(cmp.Compare(b.Priority, a.Priority), cmp.Compare(a.Symbol, b.Symbol), cmp.Compare(a.Type, b.Type))
	})
	return out
}

func id(typ, symbol string, at time.Time) string {
	return typ + ":" + symbol + ":" + at.UTC().Format(time.DateOnly)
}

func completeness(ok bool) string {
	if ok {
		return Complete
	}
	return Partial
}

func hourText(h string) string {
	switch h {
	case "bmo":
		return "ก่อนตลาดเปิด"
	case "amc":
		return "หลังตลาดปิด"
	case "dmh":
		return "ระหว่างเวลาทำการ"
	}
	return "ยังไม่ระบุเวลา"
}

func daysBetween(a, b string) int {
	ta, err1 := time.Parse(time.DateOnly, a)
	tb, err2 := time.Parse(time.DateOnly, b)
	if err1 != nil || err2 != nil {
		return math.MaxInt32
	}
	return int(math.Round(tb.Sub(ta).Hours() / 24))
}

func dedupe(s []string) []string {
	var out []string
	for _, v := range s {
		if v != "" && !slices.Contains(out, v) {
			out = append(out, v)
		}
	}
	return out
}
