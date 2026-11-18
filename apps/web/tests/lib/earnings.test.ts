import { describe, expect, it } from "vitest";

import {
  addDays,
  calendarWindow,
  compareOutcome,
  firstEvents,
  formatAmountCompact,
  groupByDate,
  marketToday,
  matchesQuery,
  surprisePercent,
} from "@/lib/earnings";
import type { EarningsEvent } from "@/types/api";

function ev(symbol: string, date: string, extra: Partial<EarningsEvent> = {}): EarningsEvent {
  return {
    symbol,
    date,
    hour: "amc",
    epsEstimate: null,
    revenueEstimate: null,
    epsActual: null,
    revenueActual: null,
    ...extra,
  };
}

describe("earnings dates", () => {
  it("uses the New York date, not the device's", () => {
    // 03:00 UTC on the 18th is 10 PM on the 17th in New York (and 10 AM on the 18th in Bangkok).
    expect(marketToday(new Date("2026-11-18T03:00:00Z"))).toBe("2026-11-17");
  });

  it("shifts calendar dates across months and years", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
  });

  it("gives each tab a window of at most two weeks", () => {
    expect(calendarWindow("today", "2026-11-17")).toEqual({ from: "2026-11-17", to: "2026-11-17" });
    expect(calendarWindow("upcoming", "2026-11-17")).toEqual({
      from: "2026-11-18",
      to: "2026-11-30",
    });
    expect(calendarWindow("past", "2026-11-17")).toEqual({ from: "2026-11-04", to: "2026-11-16" });
  });
});

describe("earnings figures", () => {
  it("compares like the API: equal is inline, sub-cent differences count", () => {
    expect(compareOutcome(2.1, 2.0263)).toBe("beat");
    expect(compareOutcome(-0.08, -0.0765)).toBe("miss");
    expect(compareOutcome(1.05, 1.05)).toBe("inline");
    expect(compareOutcome(0, 0)).toBe("inline");
    expect(compareOutcome(0.01, 0)).toBe("beat");
    expect(compareOutcome(null, 1)).toBe("");
    expect(compareOutcome(1, null)).toBe("");
  });

  it("never divides by a zero or missing estimate", () => {
    expect(surprisePercent(-0.08, -0.1)).toBeCloseTo(20);
    expect(surprisePercent(1, 0)).toBeNull();
    expect(surprisePercent(null, 1)).toBeNull();
  });

  it("formats revenue compactly without claiming a currency the vendor doesn't name", () => {
    expect(formatAmountCompact(115_844_000_000)).toBe("115.84B");
    expect(formatAmountCompact(-1_600_000)).toBe("-1.6M");
    expect(formatAmountCompact(null)).toBe("—");
  });
});

describe("calendar lists", () => {
  it("puts the user's stocks first, then larger companies, by day", () => {
    const groups = groupByDate(
      [
        ev("ZZZ", "2026-11-19"),
        ev("NVDA", "2026-11-19", { revenueEstimate: 112e9 }),
        ev("SMALL", "2026-11-19", { revenueEstimate: 5e6 }),
        ev("RKLB", "2026-11-19", { revenueEstimate: 150e6 }),
        ev("WMT", "2026-11-18", { revenueEstimate: 170e9 }),
      ],
      new Set(["RKLB"]),
    );
    expect(groups.map((g) => g.date)).toEqual(["2026-11-18", "2026-11-19"]);
    expect(groups[1]!.events.map((e) => e.symbol)).toEqual(["RKLB", "NVDA", "SMALL", "ZZZ"]);
    expect(
      groupByDate([ev("A", "2026-11-01"), ev("B", "2026-11-02")], new Set(), true)[0]!.date,
    ).toBe("2026-11-02");
  });

  it("matches tickers and known names", () => {
    expect(matchesQuery(ev("NVDA", "2026-11-19"), "nv")).toBe(true);
    expect(matchesQuery(ev("AAPL", "2026-11-19", { name: "Apple Inc" }), "apple")).toBe(true);
    expect(matchesQuery(ev("AAPL", "2026-11-19"), "msft")).toBe(false);
    expect(matchesQuery(ev("AAPL", "2026-11-19"), "  ")).toBe(true);
  });
});

describe("firstEvents", () => {
  it("cuts a long list across days without dropping a day's heading", () => {
    const groups = [
      { date: "a", events: [ev("A1", "a"), ev("A2", "a")] },
      { date: "b", events: [ev("B1", "b"), ev("B2", "b")] },
    ];
    expect(firstEvents(groups, 3).map((g) => g.events.map((e) => e.symbol))).toEqual([
      ["A1", "A2"],
      ["B1"],
    ]);
    expect(firstEvents(groups, 2)).toHaveLength(1);
  });
});
