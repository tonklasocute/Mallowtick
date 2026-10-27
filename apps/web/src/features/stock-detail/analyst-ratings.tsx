"use client";

import { ApiErrorState } from "@/components/market/api-error-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCalendarDate } from "@/lib/format";
import { isApiError } from "@/services/api/client";
import { useRecommendations } from "@/services/api/queries";
import type { RecommendationTrend } from "@/types/api";

import { SourceNote } from "./company-fundamentals";

/** Ratings from most bullish to most bearish, with their colour on the diverging scale. */
const RATINGS: { key: keyof Omit<RecommendationTrend, "period">; label: string; bg: string }[] = [
  { key: "strongBuy", label: "ซื้อมาก", bg: "bg-rating-strong-buy" },
  { key: "buy", label: "ซื้อ", bg: "bg-rating-buy" },
  { key: "hold", label: "ถือ", bg: "bg-rating-hold" },
  { key: "sell", label: "ขาย", bg: "bg-rating-sell" },
  { key: "strongSell", label: "ขายมาก", bg: "bg-rating-strong-sell" },
];

/**
 * How many analysts rate the stock buy, hold or sell this month. Renders nothing when no
 * vendor is configured (the company card says so) or no analyst covers the symbol.
 */
export function AnalystRatings({ symbol }: { symbol: string }) {
  const { data, error, isPending, refetch } = useRecommendations(symbol);

  if (isPending) {
    return (
      <Card>
        <CardTitle className="mb-2">มุมมองนักวิเคราะห์</CardTitle>
        <div aria-busy="true" aria-label="กำลังโหลดมุมมองนักวิเคราะห์">
          <Skeleton className="h-16 w-full" />
        </div>
      </Card>
    );
  }
  if (!data) {
    if (isApiError(error) && error.code === "provider_not_configured") return null;
    return (
      <Card>
        <CardTitle className="mb-2">มุมมองนักวิเคราะห์</CardTitle>
        <ApiErrorState error={error} onRetry={() => void refetch()} compact />
      </Card>
    );
  }
  const latest = data.trends[0];
  const total = latest ? RATINGS.reduce((sum, r) => sum + latest[r.key], 0) : 0;
  if (!latest || total === 0) return null;

  const buyShare = Math.round(((latest.strongBuy + latest.buy) / total) * 100);
  const summary = RATINGS.map((r) => `${r.label} ${latest[r.key]}`).join(", ");

  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <CardTitle>มุมมองนักวิเคราะห์</CardTitle>
        <Badge tone="sky">ข้อมูล {formatCalendarDate(latest.period, "month")}</Badge>
      </div>
      <p className="mt-0.5 mb-3 text-sm font-light text-slate-strong">
        นักวิเคราะห์ {total} ราย · {buyShare}% ให้ซื้อ
      </p>
      <div role="img" aria-label={`จำนวนนักวิเคราะห์: ${summary}`} className="flex h-3 gap-0.5">
        {RATINGS.filter((r) => latest[r.key] > 0).map((r) => (
          <span
            key={r.key}
            title={`${r.label} ${latest[r.key]} ราย`}
            className={`${r.bg} rounded-full`}
            style={{ flexGrow: latest[r.key], flexBasis: 0 }}
          />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-5 gap-1 text-center">
        {RATINGS.map((r) => (
          <li key={r.key} className="flex flex-col items-center gap-0.5">
            <span className="flex items-center gap-1 text-[11px] font-light text-slate">
              <span aria-hidden className={`${r.bg} size-2 rounded-full`} />
              {r.label}
            </span>
            <span className="tabular text-sm font-semibold text-ink">{latest[r.key]}</span>
          </li>
        ))}
      </ul>
      <SourceNote freshness={data.freshness}>
        ความเห็นของนักวิเคราะห์ภายนอก ไม่ใช่คำแนะนำของ Mallowtick
      </SourceNote>
    </Card>
  );
}
