"use client";

import { UsersRound } from "lucide-react";

import { ApiErrorState } from "@/components/market/api-error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { formatCalendarDate } from "@/lib/format";
import { isApiError } from "@/services/api/client";
import { useRecommendations } from "@/services/api/queries";
import type { RecommendationTrend } from "@/types/api";

import { CardBadge, CardHeading, DetailCard, SourceNote } from "./detail-ui";

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
      <DetailCard aria-label="มุมมองนักวิเคราะห์">
        <CardHeading icon={UsersRound} tone="lavender" title="มุมมองนักวิเคราะห์" />
        <div aria-busy="true" aria-label="กำลังโหลดมุมมองนักวิเคราะห์">
          <Skeleton className="h-24 w-full" />
        </div>
      </DetailCard>
    );
  }
  if (!data) {
    if (isApiError(error) && error.code === "provider_not_configured") return null;
    return (
      <DetailCard aria-label="มุมมองนักวิเคราะห์">
        <CardHeading icon={UsersRound} tone="lavender" title="มุมมองนักวิเคราะห์" />
        <ApiErrorState error={error} onRetry={() => void refetch()} compact />
      </DetailCard>
    );
  }
  const latest = data.trends[0];
  const total = latest ? RATINGS.reduce((sum, r) => sum + latest[r.key], 0) : 0;
  if (!latest || total === 0) return null;

  const buyShare = Math.round(((latest.strongBuy + latest.buy) / total) * 100);
  const summary = RATINGS.map((r) => `${r.label} ${latest[r.key]}`).join(", ");

  return (
    <DetailCard aria-label="มุมมองนักวิเคราะห์">
      <CardHeading
        icon={UsersRound}
        tone="lavender"
        title="มุมมองนักวิเคราะห์"
        badge={<CardBadge>ข้อมูล {formatCalendarDate(latest.period, "month")}</CardBadge>}
      />
      <p className="flex items-end gap-3">
        <span
          className={cn(
            "tabular font-display text-[44px] leading-none font-black tracking-[-1px]",
            buyShare >= 50 ? "text-up" : "text-ink",
          )}
        >
          {buyShare}%
        </span>
        <span className="flex flex-col gap-0.5 pb-1">
          <b className="text-[15px] font-medium text-ink">ให้ซื้อ</b>
          <span className="text-xs text-slate">จากนักวิเคราะห์ {total} ราย</span>
        </span>
      </p>
      <div role="img" aria-label={`จำนวนนักวิเคราะห์: ${summary}`} className="flex h-4 gap-1">
        {RATINGS.filter((r) => latest[r.key] > 0).map((r) => (
          <span
            key={r.key}
            title={`${r.label} ${latest[r.key]} ราย`}
            className={cn(r.bg, "rounded-full")}
            style={{ flexGrow: latest[r.key], flexBasis: 0 }}
          />
        ))}
      </div>
      <ul className="grid grid-cols-5 gap-1">
        {RATINGS.map((r) => (
          <li
            key={r.key}
            className="flex flex-col items-center gap-1 rounded-[14px] bg-cream-deep px-0.5 py-2"
          >
            <span className="inline-flex items-center gap-1 text-[11px] whitespace-nowrap text-slate">
              <span aria-hidden className={cn(r.bg, "size-2 rounded-full")} />
              {r.label}
            </span>
            <b
              className={cn(
                "tabular font-display text-[17px] font-black",
                latest[r.key] === 0 ? "text-faint" : "text-ink",
              )}
            >
              {latest[r.key]}
            </b>
          </li>
        ))}
      </ul>
      <SourceNote freshness={data.freshness}>
        ความเห็นของนักวิเคราะห์ภายนอก ไม่ใช่คำแนะนำของ Mallowtick
      </SourceNote>
    </DetailCard>
  );
}
