import { describe, expect, it } from "vitest";

import {
  direction,
  formatBarTime,
  EMPTY,
  formatCompact,
  formatDuration,
  formatMarketTime,
  formatPrice,
  formatSignedChange,
  formatSignedPercent,
} from "@/lib/format";

describe("format", () => {
  it("formats prices with currency and sensible precision", () => {
    expect(formatPrice(189.32)).toBe("$189.32");
    expect(formatPrice(1234.5)).toBe("$1,234.50");
    expect(formatPrice(0.12345)).toBe("$0.1235");
    expect(formatPrice(null)).toBe(EMPTY);
    expect(formatPrice(Number.NaN)).toBe(EMPTY);
  });

  it("signs changes and percentages", () => {
    expect(formatSignedChange(1.86)).toBe("+1.86");
    expect(formatSignedChange(-0.49)).toBe("-0.49");
    expect(formatSignedChange(0)).toBe("0.00");
    expect(formatSignedPercent(0.99)).toBe("+0.99%");
    expect(formatSignedPercent(-2.5)).toBe("-2.50%");
    expect(formatSignedPercent(undefined)).toBe(EMPTY);
  });

  it("classifies direction, treating sub-cent noise as flat", () => {
    expect(direction(1.2)).toBe("up");
    expect(direction(-0.3)).toBe("down");
    expect(direction(0.001)).toBe("flat");
    expect(direction(null)).toBe("unknown");
  });

  it("formats compact volume", () => {
    expect(formatCompact(52_400_000)).toBe("52.4M");
    expect(formatCompact(null)).toBe(EMPTY);
  });

  it("shows market time in New York, with the date when not today", () => {
    const now = new Date("2026-10-23T19:00:00Z");
    expect(formatMarketTime("2026-10-23T19:59:00Z", now)).toBe("3:59 PM ET");
    expect(formatMarketTime("2026-10-22T19:59:00Z", now)).toBe("Oct 22, 3:59 PM ET");
    expect(formatMarketTime(null, now)).toBe(EMPTY);
    expect(formatMarketTime("not a date", now)).toBe(EMPTY);
  });

  it("formats countdowns", () => {
    expect(formatDuration(16_044)).toBe("4 ชม. 27 นาที");
    expect(formatDuration(62 * 3600)).toBe("2 วัน 14 ชม.");
    expect(formatDuration(30)).toBe("1 นาที");
    expect(formatDuration(null)).toBe(EMPTY);
  });
});

describe("formatBarTime", () => {
  it("omits the time of day for daily and weekly bars", () => {
    const now = new Date("2026-10-26T15:00:00Z");
    expect(formatBarTime("2026-10-23T00:00:00-04:00", "1day", now)).toBe("Oct 23, 2026");
    expect(formatBarTime("2026-10-23T15:55:00-04:00", "5min", now)).toBe("Oct 23, 3:55 PM ET");
  });
});
