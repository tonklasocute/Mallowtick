import type { PortfolioValuation } from "@/features/portfolio/portfolio-model";
import type { Coverage, Insight, InsightFact } from "@/types/api";

import {
  formatCalendarDate,
  formatCompact,
  formatNumber,
  formatPrice,
  formatSignedPercent,
} from "./format";

/** A fact's value as text, by its unit; missing numbers read "—". */
export function formatFact(f: InsightFact): string {
  if (f.unit === "date") return f.text ? formatCalendarDate(f.text) : "—";
  if (f.unit === "text") return f.text || "—";
  if (f.value === null) return "—";
  switch (f.unit) {
    case "usd":
      return Math.abs(f.value) >= 1e6 ? `$${formatCompact(f.value)}` : formatPrice(f.value);
    case "amount":
      // Earnings figures, in the company's reporting currency (not named by the vendor).
      return Math.abs(f.value) >= 1e6 ? formatCompact(f.value) : formatNumber(f.value, 2);
    case "percent":
      return formatSignedPercent(f.value);
    case "shares":
      return formatCompact(f.value);
    case "ratio":
      return `${formatNumber(f.value, 1)} เท่า`;
    case "count":
      return String(Math.round(f.value));
  }
  return String(f.value);
}

/** The most stocks a comparison takes (the API's limit). */
export const MAX_COMPARE = 4;

/** A holding this share of the priced portfolio or more is noted. */
export const CONCENTRATION_PERCENT = 25;

/**
 * Portfolio concentration, computed on this device from the holdings and their quotes: the
 * holdings stay here. Notes a single holding at 25% or more of the priced value. It describes
 * the portfolio's make-up; it is not advice to change it.
 */
export function concentrationInsights(v: PortfolioValuation, now: Date): Insight[] {
  const priced = v.rows.filter((r) => r.weight !== null && r.quote);
  if (priced.length < 2 || v.total <= 0) return [];
  const partial = v.unpriced.length > 0;
  const sources = [...new Set(priced.map((r) => r.quote!.freshness.provider)), "mallowtick"];
  return priced
    .filter((r) => r.weight! >= CONCENTRATION_PERCENT)
    .map((r) => ({
      id: `concentration:${r.holding.symbol}`,
      type: "concentration",
      scope: "portfolio" as const,
      symbol: r.holding.symbol,
      title: `${r.holding.symbol} คิดเป็น ${formatNumber(r.weight!, 1)}% ของพอร์ต`,
      explanation:
        `หุ้นตัวเดียวมีสัดส่วนตั้งแต่ ${CONCENTRATION_PERCENT}% ของมูลค่าหุ้นที่มีราคา` +
        " ราคาของหุ้นตัวนี้จึงมีผลต่อมูลค่าพอร์ตมาก คำนวณในเครื่องนี้ ไม่ได้ส่งข้อมูลพอร์ตขึ้นเซิร์ฟเวอร์",
      method: `มูลค่าตามราคาล่าสุด ÷ มูลค่ารวมของหุ้นที่มีราคา (ตั้งแต่ ${CONCENTRATION_PERCENT}%)`,
      facts: [
        {
          label: "สัดส่วนในพอร์ต",
          value: null,
          text: `${formatNumber(r.weight!, 1)}%`,
          unit: "text" as const,
        },
        { label: "จำนวนหุ้นที่มีราคา", value: priced.length, unit: "count" as const },
      ],
      sources,
      asOf: now.toISOString(),
      completeness: partial ? ("partial" as const) : ("complete" as const),
      reliability: "medium" as const,
      tone: "neutral" as const,
      priority: 75,
    }));
}

const DATA_LABELS: Record<string, string> = {
  quote: "ราคา",
  technicals: "กราฟรายวัน",
  earnings: "ปฏิทินงบ",
  results: "ผลประกอบการ",
  news: "ข่าว",
  sectors: "กลุ่มอุตสาหกรรม",
  benchmarks: "ดัชนี",
  fundamentals: "ข้อมูลบริษัท",
  ratings: "นักวิเคราะห์",
};

export const dataLabel = (d: string) => DATA_LABELS[d] ?? d;

/** Whether the API is still filling some data in (it asks again shortly). */
export const isFilling = (c: Coverage[]) =>
  c.some((x) => x.missing.some((m) => m.reason === "rate_limited"));

/** "TSLA: กราฟรายวัน, ผลประกอบการ" lines for what an answer lacked. */
export function coverageLines(c: Coverage[]): string[] {
  return c
    .filter((x) => x.missing.length > 0)
    .map(
      (x) =>
        `${x.symbol || "ภาพรวมตลาด"}: ${[...new Set(x.missing.map((m) => dataLabel(m.data)))].join(", ")}`,
    );
}
