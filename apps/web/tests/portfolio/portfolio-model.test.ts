import { describe, expect, it } from "vitest";

import {
  allocationSlices,
  EMPTY_PORTFOLIO,
  formatMoney,
  type Holding,
  MAX_HOLDINGS,
  parseDecimal,
  type Portfolio,
  PortfolioFullError,
  removeHolding,
  sanitizePortfolio,
  upsertHolding,
  valuePortfolio,
} from "@/features/portfolio/portfolio-model";
import type { Quote } from "@/types/api";

import { quote } from "../fixtures";

const holding = (h: Partial<Holding> & { symbol: string }): Holding => ({
  shares: 1,
  avgCost: 100,
  buyRate: null,
  targetPrice: null,
  stopLoss: null,
  targetWeight: null,
  ...h,
});

const quotes = (...qs: Quote[]) => new Map(qs.map((q) => [q.symbol, q]));

const AAPL = holding({ symbol: "AAPL", shares: 10, avgCost: 250, buyRate: 35.2 });
const TSLA = holding({ symbol: "TSLA", shares: 5, avgCost: 520 });
const aapl = quote({ symbol: "AAPL", price: 343.91, change: -2.94 });
const tsla = quote({ symbol: "TSLA", price: 425.1, change: -7.9 });

describe("sanitizePortfolio", () => {
  it("keeps valid holdings once, in order, and drops what it can't trust", () => {
    const p = sanitizePortfolio({
      currency: "USD",
      goal: { amount: 1_000_000, currency: "THB" },
      holdings: [
        { symbol: "aapl", shares: 0.25, avgCost: 250, buyRate: 35.2, targetWeight: 25 },
        { symbol: "AAPL", shares: 1, avgCost: 1 },
        { symbol: "BAD SYMBOL", shares: 1, avgCost: 1 },
        { symbol: "TSLA", shares: -1, avgCost: 1 },
        { symbol: "NVDA", shares: 2, avgCost: 120, stopLoss: -5, targetWeight: 150 },
        "junk",
      ],
    });
    expect(p.currency).toBe("USD");
    expect(p.goal).toEqual({ amount: 1_000_000, currency: "THB" });
    expect(p.holdings).toEqual([
      holding({ symbol: "AAPL", shares: 0.25, avgCost: 250, buyRate: 35.2, targetWeight: 25 }),
      holding({ symbol: "NVDA", shares: 2, avgCost: 120 }),
    ]);
  });

  it("falls back to an empty baht portfolio", () => {
    expect(sanitizePortfolio(null)).toEqual(EMPTY_PORTFOLIO);
    expect(sanitizePortfolio({ currency: "EUR", goal: { amount: 0, currency: "THB" } })).toEqual(
      EMPTY_PORTFOLIO,
    );
  });
});

describe("editing holdings", () => {
  it("replaces a holding in place, removes one, and stops at the batch limit", () => {
    const p: Portfolio = { ...EMPTY_PORTFOLIO, holdings: [AAPL, TSLA] };
    const edited = upsertHolding(p, { ...AAPL, shares: 12 });
    expect(edited.holdings.map((h) => [h.symbol, h.shares])).toEqual([
      ["AAPL", 12],
      ["TSLA", 5],
    ]);
    expect(removeHolding(edited, "AAPL").holdings.map((h) => h.symbol)).toEqual(["TSLA"]);

    const full: Portfolio = {
      ...EMPTY_PORTFOLIO,
      holdings: Array.from({ length: MAX_HOLDINGS }, (_, i) => holding({ symbol: `S${i}` })),
    };
    expect(() => upsertHolding(full, holding({ symbol: "NEW" }))).toThrow(PortfolioFullError);
    expect(upsertHolding(full, holding({ symbol: "S0", shares: 3 })).holdings[0]?.shares).toBe(3);
  });
});

describe("parseDecimal", () => {
  it("reads typed amounts and tells empty from invalid", () => {
    expect(parseDecimal("1,000,000")).toBe(1_000_000);
    expect(parseDecimal(" ฿250.50 ")).toBe(250.5);
    expect(parseDecimal(".25")).toBe(0.25);
    expect(parseDecimal("")).toBeNull();
    expect(parseDecimal("12abc")).toBeNaN();
    expect(parseDecimal("-5")).toBeNaN();
  });
});

describe("formatMoney", () => {
  it("shows whole baht and dollars with cents", () => {
    expect(formatMoney(113_902.99, "THB")).toBe("฿113,903");
    expect(formatMoney(-5200, "THB", true)).toBe("-฿5,200");
    expect(formatMoney(25_902.4, "THB", true)).toBe("+฿25,902");
    expect(formatMoney(3439.1, "USD")).toBe("$3,439.10");
  });
});

describe("valuePortfolio", () => {
  const p: Portfolio = {
    holdings: [AAPL, TSLA],
    goal: { amount: 1_000_000, currency: "THB" },
    currency: "THB",
  };

  it("values in baht with the cost at the purchase rate, and splits the gain", () => {
    const v = valuePortfolio({ ...p, holdings: [AAPL] }, quotes(aapl), 33.12);
    expect(v.currency).toBe("THB");
    expect(v.total).toBeCloseTo(113_902.99, 2);
    expect(v.cost).toBe(88_000);
    expect(v.pl).toBeCloseTo(25_902.99, 2);
    // The price added 31,103 baht and the stronger baht took 5,200 away.
    expect(v.stockPart).toBeCloseTo(31_102.99, 2);
    expect(v.fxPart).toBeCloseTo(-5200, 6);
    expect(v.stockPart! + v.fxPart!).toBeCloseTo(v.pl, 6);
    expect(v.dayPct).toBeCloseTo((-29.4 / (3439.1 + 29.4)) * 100, 6);
    expect(v.goal?.progress).toBeCloseTo(11.39, 2);
  });

  it("costs a holding without a purchase rate at today's rate", () => {
    const v = valuePortfolio({ ...p, holdings: [TSLA] }, quotes(tsla), 33.12);
    expect(v.cost).toBeCloseTo(2600 * 33.12, 6);
    expect(v.fxPart).toBe(0);
  });

  it("shows dollars, ranks by value and leaves unpriced holdings out of the totals", () => {
    const nvda = holding({ symbol: "NVDA", shares: 8, avgCost: 120 });
    const v = valuePortfolio(
      { ...p, currency: "USD", holdings: [TSLA, nvda, AAPL] },
      quotes(aapl, tsla),
      33.12,
    );
    expect(v.currency).toBe("USD");
    expect(v.rows.map((r) => r.holding.symbol)).toEqual(["AAPL", "TSLA", "NVDA"]);
    expect(v.total).toBeCloseTo(3439.1 + 2125.5, 6);
    expect(v.unpriced).toEqual(["NVDA"]);
    expect(v.rows[2]).toMatchObject({ value: null, weight: null });
    expect(v.rows[0]?.weight).toBeCloseTo((3439.1 / 5564.6) * 100, 6);
    expect(v.stockPart).toBeNull();
    // The baht goal is converted to dollars.
    expect(v.goal?.amount).toBeCloseTo(1_000_000 / 33.12, 6);
  });

  it("falls back to dollars without a baht rate", () => {
    const v = valuePortfolio(p, quotes(aapl, tsla), null);
    expect(v.currency).toBe("USD");
    expect(v.goal).toBeNull(); // a baht goal can't be compared without the rate
  });
});

describe("allocationSlices", () => {
  it("groups the smallest holdings past six", () => {
    const syms = ["A", "B", "C", "D", "E", "F", "G"];
    const p: Portfolio = {
      ...EMPTY_PORTFOLIO,
      currency: "USD",
      holdings: syms.map((s, i) => holding({ symbol: s, shares: 7 - i })),
    };
    const slices = allocationSlices(
      valuePortfolio(p, quotes(...syms.map((s) => quote({ symbol: s, price: 100 }))), null),
    );
    expect(slices.map((s) => s.label)).toEqual(["A", "B", "C", "D", "E", "อื่น ๆ"]);
    expect(slices.reduce((s, x) => s + x.pct, 0)).toBeCloseTo(100, 6);
  });
});
