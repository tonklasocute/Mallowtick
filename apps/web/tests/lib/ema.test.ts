import { describe, expect, it } from "vitest";

import { ema } from "@/lib/ema";

describe("ema", () => {
  it("seeds with the simple average, then smooths with k = 2 / (period + 1)", () => {
    const out = ema([2, 4, 6, 8, 10], 3);
    expect(out.slice(0, 2)).toEqual([null, null]);
    expect(out[2]).toBe(4); // (2 + 4 + 6) / 3
    expect(out[3]).toBe(6); // 8 × 0.5 + 4 × 0.5
    expect(out[4]).toBe(8); // 10 × 0.5 + 6 × 0.5
  });

  it("stays null when there are fewer values than the period", () => {
    expect(ema([1, 2, 3], 5)).toEqual([null, null, null]);
  });

  it("follows a constant series exactly", () => {
    expect(ema(Array(30).fill(7), 20).slice(19)).toEqual(Array(11).fill(7));
  });

  it("skips non-finite values instead of producing NaN", () => {
    const out = ema([1, Number.NaN, 3, 5], 2);
    expect(out).toEqual([null, null, 2, 4]);
  });

  it("rejects periods that are not positive integers", () => {
    expect(ema([1, 2, 3], 0)).toEqual([null, null, null]);
    expect(ema([1, 2, 3], 1.5)).toEqual([null, null, null]);
  });
});
