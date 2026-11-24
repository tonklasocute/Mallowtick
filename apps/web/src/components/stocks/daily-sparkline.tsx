"use client";

import { Sparkline } from "@/components/charts/sparkline";
import { useInView } from "@/hooks/use-in-view";
import { useDailySparkline } from "@/services/api/queries";
import type { Candle } from "@/types/api";

/**
 * One month of daily closes for `symbol` as `[ref, candles, failed]`, requested only once
 * the element behind `ref` has been on screen (never while it is `display: none`). `candles`
 * stays null until there are two points to draw. The line is optional: a failed request
 * (e.g. `rate_limited` after its one retry) only sets `failed`, and callers show nothing
 * rather than an error.
 */
export function useInViewDailySparkline<T extends Element>(symbol: string) {
  const [ref, inView] = useInView<T>();
  const { data, isError } = useDailySparkline(symbol, inView);
  const candles: Candle[] | null = data && data.candles.length >= 2 ? data.candles : null;
  // A tuple, like useInView: the hooks lint rule treats every field of an object holding a
  // ref as a ref.
  return [ref, candles, isError && !candles] as const;
}

/**
 * A list row's month line, coloured by the line's own direction rather than today's change
 * next to it. The wrapper is what is observed, so its `className` decides when it loads.
 */
export function DailySparkline({ symbol, className }: { symbol: string; className?: string }) {
  const [ref, candles] = useInViewDailySparkline<HTMLSpanElement>(symbol);
  return (
    <span ref={ref} className={className}>
      {candles && <Sparkline candles={candles} />}
    </span>
  );
}
