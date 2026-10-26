"use client";

import { CircleSlash } from "lucide-react";
import Link from "next/link";

import { Sparkline } from "@/components/charts/sparkline";
import { FreshnessBadge, FreshnessInline } from "@/components/market/freshness-badge";
import { PriceChange } from "@/components/market/price-change";
import { Card } from "@/components/ui/card";
import { direction, formatPrice } from "@/lib/format";
import { useSparkline } from "@/services/api/queries";
import type { Quote } from "@/types/api";

import type { UnavailableItem } from "./overview-model";

const stockHref = (symbol: string) => `/stocks/${encodeURIComponent(symbol)}`;

/** Intraday line from real candles; renders nothing until they load. */
function HeroSparkline({ quote }: { quote: Quote }) {
  const { data } = useSparkline(quote.symbol);
  if (!data || data.candles.length < 2) return null;
  return (
    <Sparkline
      candles={data.candles}
      width={150}
      height={48}
      trend={direction(quote.changePercent ?? quote.change)}
    />
  );
}

export function BenchmarkHeroCard({ quote, receivedAt }: { quote: Quote; receivedAt: number }) {
  return (
    <Link href={stockHref(quote.symbol)} className="block rounded-card">
      <Card className="border-mint/60 transition hover:border-mint">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-display text-base font-semibold text-ink">{quote.symbol}</p>
            <p className="truncate text-xs text-slate">{quote.name}</p>
          </div>
          <FreshnessBadge
            freshness={quote.freshness}
            isMarketOpen={quote.isMarketOpen}
            receivedAt={receivedAt}
            showDetail={false}
          />
        </div>
        <div className="mt-2 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="tabular font-display text-3xl font-bold text-ink lg:text-4xl">
              {formatPrice(quote.price, quote.currency)}
            </p>
            <PriceChange change={quote.change} changePercent={quote.changePercent} />
          </div>
          <HeroSparkline quote={quote} />
        </div>
        <FreshnessInline
          className="mt-2"
          freshness={quote.freshness}
          isMarketOpen={quote.isMarketOpen}
          receivedAt={receivedAt}
        />
      </Card>
    </Link>
  );
}

export function BenchmarkTile({ quote, receivedAt }: { quote: Quote; receivedAt: number }) {
  return (
    <Link href={stockHref(quote.symbol)} className="block h-full rounded-card">
      <Card className="h-full p-3 transition hover:border-mint">
        <p className="font-display text-sm font-semibold text-ink">{quote.symbol}</p>
        <p className="truncate text-[11px] text-slate">{quote.name}</p>
        <p className="tabular mt-1.5 text-lg font-bold text-ink">
          {formatPrice(quote.price, quote.currency)}
        </p>
        <div>
          <PriceChange
            change={quote.change}
            changePercent={quote.changePercent}
            className="text-xs"
          />
        </div>
        <FreshnessInline
          className="mt-1"
          freshness={quote.freshness}
          isMarketOpen={quote.isMarketOpen}
          receivedAt={receivedAt}
        />
      </Card>
    </Link>
  );
}

/** Placeholder tile for a configured benchmark whose quote couldn't be loaded. No price is shown. */
export function UnavailableBenchmarkTile({ item }: { item: UnavailableItem }) {
  return (
    <Card className="h-full border-dashed bg-cream p-3 shadow-none">
      <p className="font-display text-sm font-semibold text-slate-strong">{item.symbol}</p>
      <p className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-slate-strong">
        <CircleSlash aria-hidden className="size-3.5" />
        Unavailable
      </p>
      <p className="text-[11px] text-slate">{item.label}</p>
    </Card>
  );
}
