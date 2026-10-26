import { describe, expect, it } from "vitest";

import { timeZoneOffsetSeconds, toChartTime } from "@/lib/exchange-time";

describe("exchange time", () => {
  it("computes New York offsets across daylight saving", () => {
    expect(timeZoneOffsetSeconds(Date.parse("2026-07-01T12:00:00Z"), "America/New_York")).toBe(
      -4 * 3600,
    );
    expect(timeZoneOffsetSeconds(Date.parse("2026-01-15T12:00:00Z"), "America/New_York")).toBe(
      -5 * 3600,
    );
  });

  it("shifts instants so the chart shows exchange wall-clock time", () => {
    // 09:30 EDT = 13:30 UTC; the chart should label it 09:30.
    const t = toChartTime("2026-10-23T09:30:00-04:00", "America/New_York");
    expect(new Date(t * 1000).toISOString()).toBe("2026-10-23T09:30:00.000Z");
  });
});
