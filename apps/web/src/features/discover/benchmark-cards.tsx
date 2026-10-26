"use client";

import { CircleSlash } from "lucide-react";
import Link from "next/link";

import { AreaSparkline } from "@/components/charts/area-sparkline";
import { FreshnessBadge, FreshnessInline } from "@/components/market/freshness-badge";
import { PriceChange } from "@/components/market/price-change";
import { PriceText } from "@/components/market/price-text";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { direction } from "@/lib/format";
import { useSparkline } from "@/services/api/queries";
import type { Quote } from "@/types/api";

import type { UnavailableItem } from "./overview-model";

const stockHref = (symbol: string) => `/stocks/${encodeURIComponent(symbol)}`;

/** Pastel chip per benchmark position: the hero card first, then the tiles. */
const CHIP_TINTS = ["bg-sky", "bg-lavender", "bg-honey", "bg-mint-soft", "bg-accent-soft"];

export const chipTint = (index: number) => CHIP_TINTS[index % CHIP_TINTS.length]!;

function TickerChip({ symbol, tint }: { symbol: string; tint: string }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-[10px] px-2.5 py-1 font-display text-xs font-extrabold tracking-wide text-ink",
        tint,
      )}
    >
      {symbol}
    </span>
  );
}

/** Intraday line from real candles against the previous close. Hidden if the candles fail. */
function HeroSparkline({ quote }: { quote: Quote }) {
  const { data, isPending } = useSparkline(quote.symbol);
  if (isPending) return <Skeleton className="mt-2 h-[92px] w-full rounded-2xl" />;
  if (!data || data.candles.length < 2) return null;
  return (
    <AreaSparkline
      className="mt-2"
      candles={data.candles}
      baseline={quote.previousClose}
      trend={direction(quote.changePercent ?? quote.change)}
    />
  );
}

export function BenchmarkHeroCard({ quote, receivedAt }: { quote: Quote; receivedAt: number }) {
  return (
    <Link href={stockHref(quote.symbol)} className="block rounded-[1.5rem]">
      <Card className="rounded-[1.5rem] px-4.5 pt-4.5 pb-3 transition hover:border-mint">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <TickerChip symbol={quote.symbol} tint={chipTint(0)} />
            <span className="truncate text-xs font-semibold text-slate">{quote.name}</span>
          </div>
          <FreshnessBadge
            freshness={quote.freshness}
            isMarketOpen={quote.isMarketOpen}
            receivedAt={receivedAt}
            showDetail={false}
            className="shrink-0"
          />
        </div>
        <div className="mt-2.5 flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
          <PriceText
            value={quote.price}
            currency={quote.currency}
            className="font-display text-[34px] leading-tight font-extrabold tracking-tight text-ink"
          />
          <PriceChange
            change={quote.change}
            changePercent={quote.changePercent}
            variant="pill"
            className="mb-1.5"
          />
        </div>
        <HeroSparkline quote={quote} />
        <div className="mt-1 flex items-center justify-between gap-2">
          <FreshnessInline
            freshness={quote.freshness}
            isMarketOpen={quote.isMarketOpen}
            receivedAt={receivedAt}
          />
          {quote.previousClose != null && (
            <span className="text-[11px] text-slate">เส้นประ = ราคาปิดวันก่อน</span>
          )}
        </div>
      </Card>
    </Link>
  );
}

export function BenchmarkTile({
  quote,
  receivedAt,
  tint,
}: {
  quote: Quote;
  receivedAt: number;
  tint: string;
}) {
  return (
    <Link href={stockHref(quote.symbol)} className="block h-full rounded-[1.5rem]">
      <Card className="flex h-full flex-col items-start gap-1 rounded-[1.5rem] p-3.5 transition hover:border-mint">
        <TickerChip symbol={quote.symbol} tint={tint} />
        <span className="w-full truncate text-xs font-semibold text-slate">{quote.name}</span>
        <PriceText
          value={quote.price}
          currency={quote.currency}
          className="mt-1 font-display text-[22px] leading-tight font-extrabold tracking-tight text-ink"
        />
        <PriceChange
          change={quote.change}
          changePercent={quote.changePercent}
          variant="pill"
          className="text-[11.5px]"
        />
        <FreshnessInline
          className="mt-auto pt-1"
          freshness={quote.freshness}
          isMarketOpen={quote.isMarketOpen}
          receivedAt={receivedAt}
        />
      </Card>
    </Link>
  );
}

/** Placeholder tile for a configured benchmark whose quote couldn't be loaded. No price is shown. */
export function UnavailableBenchmarkTile({ item, tint }: { item: UnavailableItem; tint: string }) {
  return (
    <Card className="flex h-full flex-col items-start gap-1 rounded-[1.5rem] border-dashed bg-cream p-3.5 shadow-none">
      <span className="opacity-60">
        <TickerChip symbol={item.symbol} tint={tint} />
      </span>
      <p className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-slate-strong">
        <CircleSlash aria-hidden className="size-3.5" />
        ไม่มีข้อมูล
      </p>
      <p className="text-[11px] text-slate">{item.label}</p>
    </Card>
  );
}
