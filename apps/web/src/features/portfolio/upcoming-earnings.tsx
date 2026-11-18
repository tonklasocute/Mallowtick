"use client";

import { CalendarDays, ChevronRight } from "lucide-react";
import Link from "next/link";

import { ApiErrorState } from "@/components/market/api-error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { addDays, formatEps, hourLabel, isReported, marketToday } from "@/lib/earnings";
import { formatCalendarDate, formatMarketTime } from "@/lib/format";
import { vendorLabel } from "@/lib/providers";
import { isApiError } from "@/services/api/client";
import { useEarningsCalendar } from "@/services/api/queries";

/** Four weeks ahead: within one calendar request, and long enough to plan around. */
export const UPCOMING_DAYS = 28;

function daysUntil(date: string, today: string): number {
  return Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
}

function countdown(date: string, today: string): string {
  const d = daysUntil(date, today);
  return d === 0 ? "วันนี้" : d === 1 ? "พรุ่งนี้" : `อีก ${d} วัน`;
}

/**
 * Reports coming up for the stocks held, soonest first. Only the tickers are sent, as a
 * filter on the market's calendar; nothing about the holdings leaves the device.
 */
export function UpcomingEarnings({ symbols, now = new Date() }: { symbols: string[]; now?: Date }) {
  const today = marketToday(now);
  const to = addDays(today, UPCOMING_DAYS - 1);
  const { data, error, isPending, refetch } = useEarningsCalendar(
    today,
    to,
    symbols,
    symbols.length > 0,
  );

  if (symbols.length === 0) return null;
  if (!data && isApiError(error) && error.code === "provider_not_configured") return null;
  const events = (data?.events ?? []).filter((e) => e.date >= today && !isReported(e));

  return (
    <section aria-labelledby="upcoming-earnings-title" className="flex flex-col gap-2.5">
      <div className="mx-1 flex items-center justify-between">
        <h2 id="upcoming-earnings-title" className="text-[17px] font-medium text-ink">
          งบที่กำลังจะประกาศ
        </h2>
        <Link
          href="/earnings"
          className="inline-flex min-h-9 items-center gap-0.5 text-[12.5px] text-slate hover:text-ink"
        >
          ปฏิทินทั้งหมด
          <ChevronRight aria-hidden className="size-4" />
        </Link>
      </div>
      {isPending && !data ? (
        <Skeleton className="h-16 w-full rounded-2xl" />
      ) : !data ? (
        <div className="rounded-2xl border border-line bg-surface">
          <ApiErrorState error={error} onRetry={() => void refetch()} compact />
        </div>
      ) : events.length === 0 ? (
        <p className="rounded-2xl bg-cream-deep px-3.5 py-3 text-[13px] text-slate">
          ไม่มีหุ้นในพอร์ตประกาศงบใน 4 สัปดาห์ข้างหน้า
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {events.map((e) => (
            <li key={`${e.symbol}-${e.date}`}>
              <Link
                href={`/stocks/${encodeURIComponent(e.symbol)}`}
                className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-3.5 py-3 shadow-soft hover:border-line-strong"
              >
                <span
                  aria-hidden
                  className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-lavender text-lavender-ink"
                >
                  <CalendarDays className="size-[18px]" strokeWidth={2.2} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-[15px] font-black text-ink">
                    {e.symbol}
                  </span>
                  <span className="block truncate text-[12px] font-light text-slate">
                    {formatCalendarDate(e.date)} · {hourLabel(e.hour)}
                    {e.epsEstimate !== null && ` · EPS คาด ${formatEps(e.epsEstimate)}`}
                  </span>
                </span>
                <span className="shrink-0 rounded-full bg-lavender px-2.5 py-1 text-[11.5px] text-lavender-ink">
                  {countdown(e.date, today)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {data && (
        <p className="px-1 text-[11px] font-light text-slate">
          วันที่ตามเวลาสหรัฐฯ · ข้อมูลจาก {vendorLabel(data.freshness.provider)} · อัปเดต{" "}
          {formatMarketTime(data.freshness.fetchedAt)}
        </p>
      )}
    </section>
  );
}
