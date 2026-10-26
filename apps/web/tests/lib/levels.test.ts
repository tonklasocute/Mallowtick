import { describe, expect, it } from "vitest";

import { labelLevels } from "@/lib/levels";
import type { Level } from "@/types/api";

const level = (type: Level["type"], price: number): Level => ({
  type,
  price,
  zoneLow: price,
  zoneHigh: price,
  touches: 2,
  strength: 0.5,
  firstTouchAt: "2026-10-01T00:00:00Z",
  lastTouchAt: "2026-10-20T00:00:00Z",
});

describe("labelLevels", () => {
  it("numbers levels outward from the reference price, highest price first", () => {
    const out = labelLevels(
      [
        level("resistance", 195.2),
        level("support", 182.1),
        level("resistance", 192.5),
        level("support", 185.3),
      ],
      189.32,
    );
    expect(out.map((l) => `${l.label}@${l.price}`)).toEqual([
      "R2@195.2",
      "R1@192.5",
      "S1@185.3",
      "S2@182.1",
    ]);
    expect(out[1]!.distancePct).toBeCloseTo(1.6797, 3);
    expect(out[2]!.distancePct).toBeLessThan(0);
  });

  it("handles empty input", () => {
    expect(labelLevels([], 100)).toEqual([]);
  });
});
