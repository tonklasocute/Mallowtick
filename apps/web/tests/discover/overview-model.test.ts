import { describe, expect, it } from "vitest";

import { buildOverviewModel } from "@/features/discover/overview-model";
import { unavailableReasonLabel } from "@/lib/unavailable-reason";

import { quote } from "../fixtures";

describe("buildOverviewModel", () => {
  it("splits the first benchmark into the hero and keeps the rest as tiles", () => {
    const m = buildOverviewModel({
      benchmarks: [quote({ symbol: "SPY" }), quote({ symbol: "QQQ" }), quote({ symbol: "DIA" })],
      popular: [quote({ symbol: "AAPL" })],
      unavailable: [],
    });
    expect(m.hero?.symbol).toBe("SPY");
    expect(m.tiles.map((q) => q.symbol)).toEqual(["QQQ", "DIA"]);
    expect(m.popular.map((q) => q.symbol)).toEqual(["AAPL"]);
    expect(m).toMatchObject({ showBenchmarks: true, showPopular: true, isEmpty: false });
  });

  it("places unavailable symbols in their own section", () => {
    const m = buildOverviewModel({
      benchmarks: [],
      popular: [],
      unavailable: [
        { symbol: "SPY", reason: "rate_limited", group: "benchmark" },
        { symbol: "TSLA", reason: "not_found", group: "popular" },
        { symbol: "XYZ", reason: "provider_unavailable" },
      ],
    });
    expect(m.hero).toBeNull();
    expect(m.unavailableBenchmarks).toEqual([
      { symbol: "SPY", code: "rate_limited", label: "เกินโควตาการเรียกข้อมูล" },
    ]);
    expect(m.unavailablePopular).toEqual([
      { symbol: "TSLA", code: "not_found", label: "ไม่พบหุ้นนี้" },
    ]);
    expect(m.unavailableOther.map((u) => u.symbol)).toEqual(["XYZ"]);
    // A section with only unavailable symbols is still shown, so users see why it's missing.
    expect(m).toMatchObject({ showBenchmarks: true, showPopular: true, isEmpty: false });
  });

  it("is empty when nothing is configured", () => {
    const m = buildOverviewModel({ benchmarks: [], popular: [], unavailable: [] });
    expect(m).toMatchObject({
      isEmpty: true,
      showBenchmarks: false,
      showPopular: false,
      hero: null,
    });
  });
});

describe("unavailableReasonLabel", () => {
  it("maps known codes and falls back for unknown ones", () => {
    expect(unavailableReasonLabel("provider_not_entitled")).toBe("ไม่อยู่ในแพ็กเกจข้อมูล");
    expect(unavailableReasonLabel("something_new")).toBe("ไม่มีข้อมูล");
  });
});
