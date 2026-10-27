import type { Slice } from "./portfolio-model";

/** Slice colours as classes: SVG attributes can't read CSS variables. */
export const SLICE_FILLS = [
  "bg-slice-1",
  "bg-slice-2",
  "bg-slice-3",
  "bg-slice-4",
  "bg-slice-5",
  "bg-slice-6",
] as const;

const SLICE_STROKES = [
  "stroke-slice-1",
  "stroke-slice-2",
  "stroke-slice-3",
  "stroke-slice-4",
  "stroke-slice-5",
  "stroke-slice-6",
] as const;

const R = 56;
const C = 2 * Math.PI * R;

/** A donut of the slices with the holding count in the middle. */
export function AllocationDonut({ slices, count }: { slices: Slice[]; count: number }) {
  // Each slice starts where the ones before it end.
  const arcs = slices.map((s, i) => {
    const before = slices.slice(0, i).reduce((sum, x) => sum + x.pct, 0);
    const len = Math.max((s.pct / 100) * C - 2, 0);
    return {
      label: s.label,
      len,
      offset: -(before / 100) * C,
      stroke: SLICE_STROKES[i % SLICE_STROKES.length],
    };
  });
  return (
    <div className="relative size-[140px] shrink-0">
      <svg
        viewBox="0 0 140 140"
        className="size-full -rotate-90"
        role="img"
        aria-label="แผนภูมิวงกลมสัดส่วนพอร์ตตามหุ้น"
      >
        <circle cx="70" cy="70" r={R} fill="none" strokeWidth="20" className="stroke-cream-deep" />
        {arcs.map((a) => (
          <circle
            key={a.label}
            cx="70"
            cy="70"
            r={R}
            fill="none"
            strokeWidth="20"
            strokeDasharray={`${a.len} ${C - a.len}`}
            strokeDashoffset={a.offset}
            className={a.stroke}
          />
        ))}
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-xl font-black text-ink">{count}</span>
        <span className="text-[11px] text-slate">ตัว</span>
      </span>
    </div>
  );
}
