"use client";

import type { ReactNode } from "react";
import { LoaderCircle } from "lucide-react";

import { CandlestickChart } from "@/components/charts/candlestick-chart";
import { ApiErrorState } from "@/components/market/api-error-state";
import { Card } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { StateMessage } from "@/components/ui/state-message";
import { formatBarTime } from "@/lib/format";
import type { LabeledLevel } from "@/lib/levels";
import type { useCandles } from "@/services/api/queries";
import { CHART_RANGES, type ChartRange } from "@/types/api";

export const RANGE_LABELS: Record<ChartRange, string> = {
  "1d": "1D",
  "1w": "1W",
  "1m": "1M",
  "3m": "3M",
  "1y": "1Y",
  "5y": "5Y",
};

const INTERVAL_LABELS: Record<string, string> = {
  "5min": "5-minute",
  "30min": "30-minute",
  "1h": "hourly",
  "1day": "daily",
  "1week": "weekly",
};

const CHART_HEIGHT = 280;

interface ChartPanelProps {
  range: ChartRange;
  onRangeChange: (range: ChartRange) => void;
  candles: ReturnType<typeof useCandles>;
  levels: LabeledLevel[];
}

export function ChartPanel({ range, onRangeChange, candles, levels }: ChartPanelProps) {
  const { data, error, isPending, isPlaceholderData, isFetching, refetch } = candles;
  const options = CHART_RANGES.map((r) => ({ value: r, label: RANGE_LABELS[r] }));

  let body: ReactNode;
  if (isPending) {
    body = <Skeleton className="w-full rounded-2xl" />;
  } else if (!data) {
    body = <ApiErrorState error={error} onRetry={() => void refetch()} compact />;
  } else if (data.candles.length === 0) {
    body = (
      <StateMessage
        compact
        title="No price history for this range"
        description="The provider returned no candles. Try another range."
      />
    );
  } else {
    body = (
      <CandlestickChart
        series={data}
        levels={levels}
        intraday={["1d", "1w", "1m"].includes(range)}
        height={CHART_HEIGHT}
      />
    );
  }

  const last = data?.candles.at(-1);
  return (
    <Card className="space-y-3 px-3">
      <SegmentedControl
        label="Chart range"
        options={options}
        value={range}
        onChange={onRangeChange}
      />
      <div className="relative" style={{ minHeight: CHART_HEIGHT }}>
        <div className={isPending ? "h-[280px]" : undefined}>{body}</div>
        {isFetching && isPlaceholderData && (
          <span
            role="status"
            className="absolute top-1 left-1 inline-flex items-center gap-1 rounded-full bg-surface/90 px-2 py-0.5 text-[11px] text-slate"
          >
            <LoaderCircle aria-hidden className="size-3 animate-spin" /> Loading{" "}
            {RANGE_LABELS[range]}…
          </span>
        )}
      </div>
      {data && last && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-slate">
          <span>
            {INTERVAL_LABELS[data.interval] ?? data.interval} candles · last bar{" "}
            {formatBarTime(last.time, data.interval)}
            {data.freshness.stale && (
              <strong className="ml-1 text-down">· stale (provider unavailable)</strong>
            )}
          </span>
          {levels.length > 0 && (
            <span className="inline-flex items-center gap-3" aria-hidden>
              <span className="inline-flex items-center gap-1">
                <span className="w-4 border-t-2 border-dashed border-resistance" /> Resistance
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-4 border-t-2 border-dashed border-support" /> Support
              </span>
            </span>
          )}
        </div>
      )}
    </Card>
  );
}
