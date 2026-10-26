import type { Level } from "@/types/api";

export interface LabeledLevel extends Level {
  /** "R1" is the nearest resistance above the reference price, "S1" the nearest support. */
  label: string;
  /** Signed distance from the reference price, in percent. */
  distancePct: number;
}

/** Numbers levels outward from the reference price and returns them highest price first. */
export function labelLevels(levels: Level[], referencePrice: number): LabeledLevel[] {
  const distance = (p: number) =>
    referencePrice > 0 ? ((p - referencePrice) / referencePrice) * 100 : 0;
  const resistances = levels
    .filter((l) => l.type === "resistance")
    .sort((a, b) => a.price - b.price)
    .map((l, i) => ({ ...l, label: `R${i + 1}`, distancePct: distance(l.price) }));
  const supports = levels
    .filter((l) => l.type === "support")
    .sort((a, b) => b.price - a.price)
    .map((l, i) => ({ ...l, label: `S${i + 1}`, distancePct: distance(l.price) }));
  return [...resistances.reverse(), ...supports];
}
