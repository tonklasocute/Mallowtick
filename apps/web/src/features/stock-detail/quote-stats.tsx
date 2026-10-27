"use client";

import { Clock3 } from "lucide-react";

import { MARKET_TIMEZONE } from "@/lib/config";
import { formatCalendarDate, formatCompact, formatNumber } from "@/lib/format";
import { useFundamentals } from "@/services/api/queries";
import type { Quote } from "@/types/api";

import { CardBadge, CardHeading, DetailCard, Tile, TileGrid } from "./detail-ui";

const isNum = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** "Oct 26" in market time, the session the quote belongs to. */
function sessionDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: MARKET_TIMEZONE,
  });
}

/** Where the price sits between low and high, as a marker on a pink → honey → mint track. */
function RangeBar({
  label,
  low,
  high,
  price,
  lowNote,
  highNote,
}: {
  label: string;
  low: number;
  high: number;
  price: number;
  lowNote: string;
  highNote: string;
}) {
  const pos = high > low ? Math.min(Math.max((price - low) / (high - low), 0), 1) * 100 : 50;
  // The flag is wider than the marker; keep it inside the card near the ends.
  const flag = Math.min(Math.max(pos, 9), 91);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11.5px] text-slate">{label}</span>
      <div
        role="img"
        aria-label={`${label}: ราคา ${formatNumber(price)} อยู่ระหว่าง ${formatNumber(low)} ถึง ${formatNumber(high)}`}
        className="relative mt-[18px] h-2.5 rounded-full bg-[linear-gradient(90deg,var(--color-down-soft),var(--color-honey)_50%,var(--color-up-soft))]"
      >
        <span
          className="tabular absolute bottom-4 -translate-x-1/2 rounded-lg bg-ink px-[7px] py-0.5 font-display text-[10.5px] font-extrabold whitespace-nowrap text-surface"
          style={{ left: `${flag}%` }}
        >
          {formatNumber(price)}
        </span>
        <span
          className="absolute top-1/2 -mt-[9px] -ml-[9px] size-[18px] rounded-full border-[3px] border-surface bg-ink shadow-[0_2px_6px_rgb(29_59_50/0.3)]"
          style={{ left: `${pos}%` }}
        />
      </div>
      <div className="tabular flex justify-between font-display text-xs font-extrabold text-ink">
        <span className="flex flex-col">
          {formatNumber(low)}
          <small className="font-sans text-[10.5px] font-normal text-slate">{lowNote}</small>
        </span>
        <span className="flex flex-col items-end">
          {formatNumber(high)}
          <small className="font-sans text-[10.5px] font-normal text-slate">{highNote}</small>
        </span>
      </div>
    </div>
  );
}

export function QuoteStats({ symbol, quote }: { symbol: string; quote: Quote }) {
  // The 52-week dates come with the company's metrics, already fetched for the cards below.
  const metrics = useFundamentals(symbol).data?.metrics;
  const range52 =
    quote.fiftyTwoWeek ??
    (isNum(metrics?.fiftyTwoWeekLow) && isNum(metrics?.fiftyTwoWeekHigh)
      ? { low: metrics.fiftyTwoWeekLow, high: metrics.fiftyTwoWeekHigh }
      : null);
  const date = sessionDate(quote.asOf);

  return (
    <DetailCard aria-label="รอบการซื้อขายล่าสุด">
      <CardHeading
        icon={Clock3}
        tone="sky"
        title="รอบการซื้อขายล่าสุด"
        badge={date && <CardBadge tone="soft">{date}</CardBadge>}
      />
      <TileGrid cols={3}>
        <Tile label="ราคาเปิด" value={formatNumber(quote.open)} />
        <Tile label="ปิดครั้งก่อน" value={formatNumber(quote.previousClose)} />
        <Tile label="ปริมาณซื้อขาย" value={formatCompact(quote.volume)} />
      </TileGrid>
      {isNum(quote.low) && isNum(quote.high) && (
        <RangeBar
          label="ช่วงราคาวันนี้"
          low={quote.low}
          high={quote.high}
          price={quote.price}
          lowNote="ต่ำสุด"
          highNote="สูงสุด"
        />
      )}
      {range52 && (
        <RangeBar
          label="ช่วง 52 สัปดาห์"
          low={range52.low}
          high={range52.high}
          price={quote.price}
          lowNote={
            metrics?.fiftyTwoWeekLowDate
              ? formatCalendarDate(metrics.fiftyTwoWeekLowDate)
              : "ต่ำสุด"
          }
          highNote={
            metrics?.fiftyTwoWeekHighDate
              ? formatCalendarDate(metrics.fiftyTwoWeekHighDate)
              : "สูงสุด"
          }
        />
      )}
    </DetailCard>
  );
}
