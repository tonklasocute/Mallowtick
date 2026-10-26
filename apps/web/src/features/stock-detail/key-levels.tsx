"use client";

import type { ReactNode } from "react";
import { ApiErrorState } from "@/components/market/api-error-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StateMessage } from "@/components/ui/state-message";
import { cn } from "@/lib/cn";
import { formatBarTime, formatNumber, formatSignedPercent } from "@/lib/format";
import type { LabeledLevel } from "@/lib/levels";
import type { useLevels } from "@/services/api/queries";
import type { ChartRange } from "@/types/api";

import { RANGE_LABELS } from "./chart-panel";

interface KeyLevelsProps {
  range: ChartRange;
  query: ReturnType<typeof useLevels>;
  levels: LabeledLevel[];
}

function StrengthBar({ value, type }: { value: number; type: LabeledLevel["type"] }) {
  const pct = Math.round(Math.min(Math.max(value, 0), 1) * 100);
  return (
    <span
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label="Strength"
      className="block h-1.5 w-14 overflow-hidden rounded-full bg-cream-deep"
    >
      <span
        className={cn(
          "block h-full rounded-full",
          type === "support" ? "bg-support" : "bg-resistance",
        )}
        style={{ width: `${pct}%` }}
      />
    </span>
  );
}

export function KeyLevels({ range, query, levels }: KeyLevelsProps) {
  const { data, error, isPending, refetch } = query;

  let body: ReactNode;
  if (isPending) {
    body = (
      <div aria-busy="true" aria-label="Calculating levels" className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  } else if (!data) {
    body = <ApiErrorState error={error} onRetry={() => void refetch()} compact />;
  } else if (data.status === "insufficient_data") {
    body = (
      <StateMessage
        compact
        title="Not enough history"
        description={`Only ${data.candlesUsed} valid candles in this range — at least ${data.method.parameters.swingWindow * 2 + 1} are needed to confirm a swing.`}
      />
    );
  } else if (levels.length === 0) {
    body = (
      <StateMessage
        compact
        title="No clear levels in this range"
        description="No confirmed swing highs or lows were found. Try a longer range."
      />
    );
  } else {
    body = (
      <table className="w-full text-sm">
        <caption className="sr-only">
          Support and resistance levels for the {RANGE_LABELS[range]} range
        </caption>
        <thead className="text-left text-[11px] text-slate">
          <tr>
            <th scope="col" className="pb-1 font-medium">
              Level
            </th>
            <th scope="col" className="pb-1 text-right font-medium">
              Price
            </th>
            <th scope="col" className="pb-1 text-right font-medium">
              From last
            </th>
            <th scope="col" className="pb-1 text-right font-medium">
              Touches
            </th>
            <th scope="col" className="pb-1 pl-3 font-medium">
              Strength
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {levels.map((l) => (
            <tr key={l.label}>
              <th scope="row" className="py-2 text-left font-normal">
                <span
                  className={cn(
                    "inline-flex rounded-md border-l-[3px] px-1.5 text-xs font-semibold",
                    l.type === "support"
                      ? "border-support bg-mint-soft text-mint-deep"
                      : "border-resistance bg-accent-soft text-down",
                  )}
                >
                  {l.label}
                </span>
                <span className="sr-only"> {l.type}</span>
              </th>
              <td className="tabular py-2 text-right font-semibold text-ink">
                {formatNumber(l.price)}
              </td>
              <td className="tabular py-2 text-right text-xs text-slate-strong">
                {formatSignedPercent(l.distancePct)}
              </td>
              <td className="tabular py-2 text-right text-xs text-slate-strong">{l.touches}</td>
              <td className="py-2 pl-3">
                <StrengthBar value={l.strength} type={l.type} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <CardTitle>Key levels</CardTitle>
        <Badge tone="sky">{RANGE_LABELS[range]} · calculated</Badge>
      </div>
      {body}
      {data && data.status === "ok" && (
        <p className="mt-3 text-[11px] leading-relaxed text-slate">
          Calculated by Mallowtick from {data.candlesUsed} {data.interval} candles (last bar{" "}
          {formatBarTime(data.asOf, data.interval)}). Confirmed swing highs/lows (±
          {data.method.parameters.swingWindow} bars) clustered within{" "}
          {data.method.parameters.clusterAtrMultiple}× ATR({data.method.parameters.atrPeriod}) ={" "}
          {formatNumber(data.tolerance)}, scored by touches, recency and reaction. {data.disclaimer}
        </p>
      )}
    </Card>
  );
}
