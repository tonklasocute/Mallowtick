import type { Briefing, Insight } from "@/types/api";

export function insight(overrides: Partial<Insight> = {}): Insight {
  return {
    id: "below_ema50:AAPL:2026-10-23",
    type: "below_ema50",
    scope: "symbol",
    symbol: "AAPL",
    title: "AAPL ต่ำกว่าเส้น EMA 50 วัน",
    explanation: "ราคาล่าสุด ต่ำกว่าค่าเฉลี่ย 1.9% เป็นการเทียบตัวเลขเท่านั้น ไม่ใช่สัญญาณซื้อขาย",
    method: "EMA 50 วันจากราคาปิดรายวัน",
    facts: [
      { label: "ราคาล่าสุด", value: 189.32, unit: "usd" },
      { label: "ห่างจากเส้น", value: -1.92, unit: "percent" },
    ],
    sources: ["twelvedata", "finnhub", "mallowtick"],
    asOf: "2026-10-23T18:59:00Z",
    completeness: "complete",
    reliability: "medium",
    tone: "down",
    priority: 45,
    ...overrides,
  };
}

export function briefing(overrides: Partial<Briefing> = {}): Briefing {
  return {
    today: "2026-10-23",
    generatedAt: "2026-10-23T19:00:00Z",
    market: [
      insight({
        id: "index_move:SPY",
        type: "index_move",
        scope: "market",
        symbol: "SPY",
        title: "SPY (S&P 500) +0.71%",
        explanation: "SPY เป็นกองทุน ETF ที่อ้างอิงดัชนี ไม่ใช่ค่าดัชนีเอง",
        tone: "up",
        reliability: "high",
        sources: ["finnhub"],
      }),
    ],
    insights: [],
    thingsToWatch: [],
    coverage: [],
    disclaimer: "ข้อสังเกตสร้างโดยกฎของ Mallowtick ไม่ใช่คำแนะนำให้ซื้อหรือขาย",
    ...overrides,
  };
}
