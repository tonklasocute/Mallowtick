import { useId } from "react";

import { cn } from "@/lib/cn";
import type { Candle } from "@/types/api";

interface AreaSparklineProps {
  candles: Candle[];
  /** Drawn as a dashed line, e.g. the previous close. Included in the vertical scale. */
  baseline?: number | null;
  /** Color by the quote's day change so the line never contradicts the change label. */
  trend?: "up" | "down" | "flat" | "unknown";
  height?: number;
  className?: string;
}

const WIDTH = 300;
const PAD = 8;

/**
 * Full-width close-price line with a soft fill and a dot on the latest close,
 * drawn from real candles. Renders nothing with fewer than two points.
 */
export function AreaSparkline({
  candles,
  baseline,
  trend,
  height = 92,
  className,
}: AreaSparklineProps) {
  const gradientId = `spark-${useId().replace(/[^\w-]/g, "")}`;
  const closes = candles.map((c) => c.close).filter(Number.isFinite);
  if (closes.length < 2) return null;

  const base = baseline != null && Number.isFinite(baseline) ? baseline : null;
  const scale = base == null ? closes : [...closes, base];
  const min = Math.min(...scale);
  const max = Math.max(...scale);
  const span = max - min || 1;
  const y = (v: number) => PAD + (1 - (v - min) / span) * (height - PAD * 2);
  const pts = closes.map((c, i) => [(i / (closes.length - 1)) * WIDTH, y(c)] as const);
  const line = pts.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(" ");
  const area = `M0,${height} L${line.replaceAll(" ", " L")} L${WIDTH},${height} Z`;
  const [endX, endY] = pts[pts.length - 1]!;

  const dir =
    trend && trend !== "unknown" ? trend : closes[closes.length - 1]! >= closes[0]! ? "up" : "down";
  const color =
    dir === "up" ? "var(--color-up)" : dir === "down" ? "var(--color-down)" : "var(--color-slate)";

  return (
    <div aria-hidden className={cn("relative w-full", className)} style={{ height }}>
      {/* Stretched horizontally; strokes keep their width and the dot is HTML so it stays round. */}
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        preserveAspectRatio="none"
        className="absolute inset-0 size-full overflow-visible"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.2" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {base != null && (
          <line
            x1="0"
            x2={WIDTH}
            y1={y(base)}
            y2={y(base)}
            stroke="var(--color-peach)"
            strokeWidth="1.2"
            strokeDasharray="2 4"
            vectorEffect="non-scaling-stroke"
          />
        )}
        <path d={area} fill={`url(#${gradientId})`} />
        <polyline
          points={line}
          fill="none"
          stroke={color}
          strokeWidth="2.2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span
        className="absolute size-4 -translate-1/2 rounded-full opacity-20"
        style={{ left: `${(endX / WIDTH) * 100}%`, top: endY, backgroundColor: color }}
      />
      <span
        className="absolute size-2 -translate-1/2 rounded-full"
        style={{ left: `${(endX / WIDTH) * 100}%`, top: endY, backgroundColor: color }}
      />
    </div>
  );
}
