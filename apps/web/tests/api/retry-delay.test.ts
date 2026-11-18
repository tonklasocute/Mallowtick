import { describe, expect, it } from "vitest";

import { retryDelay } from "@/services/api/queries";

describe("retryDelay", () => {
  it("doubles the window each attempt and spreads retries over its upper half", () => {
    expect(retryDelay(0, () => 0)).toBe(500);
    expect(retryDelay(0, () => 1)).toBe(1_000);
    expect(retryDelay(1, () => 0)).toBe(1_000);
    expect(retryDelay(1, () => 1)).toBe(2_000);
  });

  it("is capped at 30 seconds", () => {
    expect(retryDelay(10, () => 1)).toBe(30_000);
    expect(retryDelay(10, () => 0)).toBe(15_000);
  });
});
