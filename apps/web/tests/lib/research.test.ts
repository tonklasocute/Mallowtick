import { describe, expect, it } from "vitest";

import { valuePortfolio } from "@/features/portfolio/portfolio-model";
import { concentrationInsights, coverageLines, formatFact, isFilling } from "@/lib/research";

import { quote } from "../fixtures";

const holding = (symbol: string, shares: number) => ({
  symbol,
  shares,
  avgCost: 100,
  buyRate: null,
  targetPrice: null,
  stopLoss: null,
  targetWeight: null,
});

describe("formatFact", () => {
  it("formats by unit and never shows a missing number as zero", () => {
    expect(formatFact({ label: "x", value: 189.32, unit: "usd" })).toBe("$189.32");
    expect(formatFact({ label: "x", value: 115_844_000_000, unit: "usd" })).toBe("$115.84B");
    expect(formatFact({ label: "x", value: -1.918, unit: "percent" })).toBe("-1.92%");
    expect(formatFact({ label: "x", value: 333_822_100, unit: "shares" })).toBe("333.82M");
    expect(formatFact({ label: "x", value: 1.598, unit: "ratio" })).toBe("1.6 เท่า");
    expect(formatFact({ label: "x", value: null, text: "2026-11-16", unit: "date" })).toBe(
      "16 พ.ย. 2026",
    );
    expect(formatFact({ label: "x", value: null, unit: "usd" })).toBe("—");
  });
});

describe("concentrationInsights", () => {
  const now = new Date("2026-10-23T19:00:00Z");

  it("notes a holding at 25% or more of the priced value, computed on the device", () => {
    const quotes = new Map([
      ["AAPL", quote({ symbol: "AAPL", price: 100 })],
      ["MSFT", quote({ symbol: "MSFT", price: 100 })],
    ]);
    const v = valuePortfolio(
      { holdings: [holding("AAPL", 3), holding("MSFT", 1)], goal: null, currency: "USD" },
      quotes,
      null,
    );
    const got = concentrationInsights(v, now);
    expect(got.map((i) => i.title)).toEqual([
      "AAPL คิดเป็น 75.0% ของพอร์ต",
      "MSFT คิดเป็น 25.0% ของพอร์ต",
    ]);
    expect(got[0]!.scope).toBe("portfolio");
    expect(got[0]!.explanation).toMatch(/ไม่ได้ส่งข้อมูลพอร์ตขึ้นเซิร์ฟเวอร์/);
    expect(got[0]!.completeness).toBe("complete");
  });

  it("is partial when a holding has no price, and silent for a single stock", () => {
    const quotes = new Map([
      ["AAPL", quote({ symbol: "AAPL", price: 100 })],
      ["MSFT", quote({ symbol: "MSFT", price: 100 })],
    ]);
    const v = valuePortfolio(
      {
        holdings: [holding("AAPL", 3), holding("MSFT", 1), holding("NOPE", 1)],
        goal: null,
        currency: "USD",
      },
      quotes,
      null,
    );
    expect(concentrationInsights(v, now)[0]!.completeness).toBe("partial");
    const one = valuePortfolio(
      { holdings: [holding("AAPL", 1)], goal: null, currency: "USD" },
      quotes,
      null,
    );
    expect(concentrationInsights(one, now)).toEqual([]);
  });
});

describe("coverage", () => {
  it("lists what is missing per symbol, and whether it is still coming", () => {
    const c = [
      {
        symbol: "TSLA",
        missing: [
          { data: "technicals", reason: "rate_limited" },
          { data: "results", reason: "rate_limited" },
        ],
      },
      { symbol: "", missing: [{ data: "sectors", reason: "provider_not_configured" }] },
    ];
    expect(coverageLines(c)).toEqual([
      "TSLA: กราฟรายวัน, ผลประกอบการ",
      "ภาพรวมตลาด: กลุ่มอุตสาหกรรม",
    ]);
    expect(isFilling(c)).toBe(true);
    expect(isFilling([c[1]!])).toBe(false);
  });
});
