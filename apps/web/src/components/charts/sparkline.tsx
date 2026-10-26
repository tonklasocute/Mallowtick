import { cn } from "@/lib/cn";
import type { Candle } from "@/types/api";

interface SparklineProps {
  candles: Candle[];
  width?: number;
  height?: number;
  /** Color by the quote's day change so the line never contradicts the change label. */
  trend?: "up" | "down" | "flat" | "unknown";
  className?: string;
}

/** Tiny close-price line drawn from real candles. Renders nothing with fewer than two points. */
export function Sparkline({ candles, width = 72, height = 28, trend, className }: SparklineProps) {
  const closes = candles.map((c) => c.close).filter(Number.isFinite);
  if (closes.length < 2) return null;
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;
  const pad = 2;
  const points = closes
    .map((c, i) => {
      const x = (i / (closes.length - 1)) * width;
      const y = pad + (1 - (c - min) / span) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const dir =
    trend && trend !== "unknown" ? trend : closes[closes.length - 1]! >= closes[0]! ? "up" : "down";
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      aria-hidden
      className={cn(
        "shrink-0 overflow-visible",
        dir === "up" ? "stroke-up" : dir === "down" ? "stroke-down" : "stroke-slate",
        className,
      )}
    >
      <polyline
        points={points}
        fill="none"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
