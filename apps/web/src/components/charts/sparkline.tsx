import { cn } from "@/lib/cn";
import { direction, type Direction } from "@/lib/format";
import type { Candle } from "@/types/api";

interface SparklineProps {
  candles: Candle[];
  width?: number;
  height?: number;
  /**
   * Colour to use instead of the line's own direction (last close against the first),
   * e.g. the quote's day change on a one-day line so it never contradicts the change label.
   */
  trend?: Direction;
  /** Fill the container's width instead of `width`; the height and stroke stay as they are. */
  stretch?: boolean;
  className?: string;
}

/** Tiny close-price line drawn from real candles. Renders nothing with fewer than two points. */
export function Sparkline({
  candles,
  width = 72,
  height = 28,
  trend,
  stretch = false,
  className,
}: SparklineProps) {
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
    trend && trend !== "unknown" ? trend : direction(closes[closes.length - 1]! - closes[0]!);
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={stretch ? undefined : width}
      height={height}
      preserveAspectRatio={stretch ? "none" : undefined}
      aria-hidden
      className={cn(
        "shrink-0 overflow-visible",
        stretch && "w-full",
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
        vectorEffect={stretch ? "non-scaling-stroke" : undefined}
      />
    </svg>
  );
}
