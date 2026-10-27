import { describe, expect, it } from "vitest";

import { buildSectorModel, heatLevel, tileSizes } from "@/features/discover/sector-model";
import type { PriceReturns, SectorsResult } from "@/types/api";

import { freshness } from "../fixtures";

const returns = (r: Partial<PriceReturns>): PriceReturns => ({
  "1d": null,
  "1w": null,
  "3m": null,
  ytd: null,
  "1y": null,
  ...r,
});

const result: SectorsResult = {
  benchmark: { symbol: "SPY", returns: returns({ "1d": 0.5, ytd: 11.45 }) },
  sectors: [
    { sector: "energy", symbol: "XLE", returns: returns({ "1d": -0.2, ytd: 55.07 }) },
    { sector: "materials", symbol: "XLB", returns: returns({ ytd: 13.14 }) },
    { sector: "technology", symbol: "XLK", returns: returns({ "1d": 1.3, ytd: 27.27 }) },
    { sector: "utilities", symbol: "XLU", returns: returns({}) },
  ],
  unavailable: [
    { symbol: "SPY", reason: "rate_limited" },
    { symbol: "XLC", reason: "rate_limited" },
  ],
  freshness: freshness({ provider: "finnhub" }),
};

describe("buildSectorModel", () => {
  it("ranks sectors by return with Thai names and the gap to the S&P 500", () => {
    const m = buildSectorModel(result, "1d");
    expect(m.benchmark).toBe(0.5);
    expect(m.rows.map((r) => r.symbol)).toEqual(["XLK", "XLE", "XLB", "XLU"]);
    expect(m.rows[0]).toMatchObject({ name: "เทคโนโลยี", value: 1.3 });
    expect(m.rows[0]?.relative).toBeCloseTo(0.8);
    expect(m.rows[1]?.relative).toBeCloseTo(-0.7);
    // No value for the period: last, and no gap to report.
    expect(m.rows[2]).toMatchObject({ name: "วัสดุ", value: null, relative: null });
  });

  it("re-ranks for another period", () => {
    const m = buildSectorModel(result, "ytd");
    expect(m.rows.map((r) => r.symbol)).toEqual(["XLE", "XLK", "XLB", "XLU"]);
    expect(m.rows[0]?.relative).toBeCloseTo(43.62);
  });

  it("leaves the gap out when the benchmark has no value", () => {
    const m = buildSectorModel({ ...result, benchmark: null }, "1d");
    expect(m.benchmark).toBeNull();
    expect(m.rows.every((r) => r.relative === null)).toBe(true);
  });

  it("lists unavailable sectors by name, without the benchmark", () => {
    expect(buildSectorModel(result, "1d").unavailable).toEqual([
      { symbol: "XLC", code: "rate_limited", label: "รอโควตา กำลังโหลดใหม่", name: "สื่อสาร" },
    ]);
  });

  it("marks half-fetched sectors as waiting instead of listing them twice", () => {
    const m = buildSectorModel(
      { ...result, unavailable: [{ symbol: "XLB", reason: "rate_limited" }] },
      "1d",
    );
    expect(m.unavailable).toEqual([]);
    expect(m.rows.find((r) => r.symbol === "XLB")).toMatchObject({ value: null, waiting: true });
    expect(m.rows.find((r) => r.symbol === "XLK")?.waiting).toBe(false);
  });

  it("keeps other reasons as failures", () => {
    const m = buildSectorModel(
      { ...result, unavailable: [{ symbol: "XLC", reason: "provider_unavailable" }] },
      "1d",
    );
    expect(m.unavailable[0]?.label).toBe("ผู้ให้บริการไม่พร้อมใช้งาน");
  });
});

describe("heatLevel", () => {
  it("grades the gap to the S&P 500 in the canvas's six steps", () => {
    expect([12, 10, 7, 5, 3, 1, 0.5, -0.9, -1, -3, -5, -8].map(heatLevel)).toEqual([
      5, 5, 4, 4, 3, 3, 2, 2, 1, 1, 0, 0,
    ]);
  });
});

describe("tileSizes", () => {
  it("matches the canvas for ten sectors: 2×2, 2 wide, six 1×1, two 2 wide", () => {
    expect(tileSizes(10)).toEqual([
      "xl",
      "wide",
      "one",
      "one",
      "one",
      "one",
      "one",
      "one",
      "wide",
      "wide",
    ]);
  });

  it("fills the last row for other counts", () => {
    const cells = (n: number) =>
      tileSizes(n).reduce((sum, s) => sum + (s === "xl" ? 4 : s === "wide" ? 2 : 1), 0);
    for (const n of [3, 4, 5, 7, 8, 9, 11, 12]) expect(cells(n) % 4).toBe(0);
    expect(tileSizes(11).filter((s) => s === "wide")).toHaveLength(2);
    expect(tileSizes(11).at(-1)).toBe("wide");
    expect(tileSizes(1)).toEqual(["xl"]);
    expect(tileSizes(0)).toEqual([]);
  });
});
