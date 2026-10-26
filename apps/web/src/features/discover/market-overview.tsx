"use client";

import Link from "next/link";

import { Sparkline } from "@/components/charts/sparkline";
import { ApiErrorState } from "@/components/market/api-error-state";
import { FreshnessBadge, FreshnessInline } from "@/components/market/freshness-badge";
import { PriceChange } from "@/components/market/price-change";
import { QuoteRow } from "@/components/stocks/quote-row";
import { Card, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StateMessage } from "@/components/ui/state-message";
import { direction, formatPrice } from "@/lib/format";
import { useMarketOverview, useSparkline } from "@/services/api/queries";
import type { Quote } from "@/types/api";

function HeroSparkline({ quote }: { quote: Quote }) {
  const { data } = useSparkline(quote.symbol);
  if (!data || data.candles.length < 2) return null;
  return (
    <Sparkline
      candles={data.candles}
      width={140}
      height={44}
      trend={direction(quote.changePercent ?? quote.change)}
    />
  );
}

function BenchmarkHero({ quote, receivedAt }: { quote: Quote; receivedAt: number }) {
  return (
    <Link href={`/stocks/${encodeURIComponent(quote.symbol)}`} className="block">
      <Card className="border-mint/60 bg-mint-soft/60 transition hover:border-mint">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-display text-sm font-semibold text-ink">{quote.symbol}</p>
            <p className="truncate text-xs text-slate-strong">{quote.name}</p>
          </div>
          <FreshnessBadge
            freshness={quote.freshness}
            isMarketOpen={quote.isMarketOpen}
            receivedAt={receivedAt}
            showDetail={false}
          />
        </div>
        <div className="mt-2 flex items-end justify-between gap-3">
          <div>
            <p className="tabular font-display text-3xl font-bold text-ink">
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

function BenchmarkTile({ quote, receivedAt }: { quote: Quote; receivedAt: number }) {
  return (
    <Link href={`/stocks/${encodeURIComponent(quote.symbol)}`} className="block">
      <Card className="h-full p-3 transition hover:border-mint">
        <p className="font-display text-sm font-semibold text-ink">{quote.symbol}</p>
        <p className="truncate text-[11px] text-slate">{quote.name}</p>
        <p className="tabular mt-1.5 text-lg font-bold text-ink">
          {formatPrice(quote.price, quote.currency)}
        </p>
        <PriceChange
          change={quote.change}
          changePercent={quote.changePercent}
          className="text-xs"
        />
        <FreshnessInline
          className="mt-1 flex"
          freshness={quote.freshness}
          isMarketOpen={quote.isMarketOpen}
          receivedAt={receivedAt}
        />
      </Card>
    </Link>
  );
}

function OverviewSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading market overview" className="space-y-3">
      <Skeleton className="h-36 w-full rounded-card" />
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-28 rounded-card" />
        <Skeleton className="h-28 rounded-card" />
      </div>
    </div>
  );
}

/** Benchmarks and popular stocks configured on the API server, from one batch request. */
export function MarketOverview() {
  const { data, error, isPending, refetch, dataUpdatedAt } = useMarketOverview();

  if (isPending) return <OverviewSkeleton />;
  if (error && !data) {
    return (
      <Card>
        <ApiErrorState error={error} onRetry={() => void refetch()} />
      </Card>
    );
  }
  if (!data) return null;

  const [hero, ...tiles] = data.benchmarks;
  const nothingConfigured =
    data.benchmarks.length + data.popular.length + data.unavailable.length === 0;

  return (
    <div className="space-y-5">
      <section aria-labelledby="benchmarks-title" className="space-y-3">
        <h2 id="benchmarks-title" className="sr-only">
          Market benchmarks
        </h2>
        {hero && <BenchmarkHero quote={hero} receivedAt={dataUpdatedAt} />}
        {tiles.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            {tiles.map((q) => (
              <BenchmarkTile key={q.symbol} quote={q} receivedAt={dataUpdatedAt} />
            ))}
          </div>
        )}
      </section>

      {data.popular.length > 0 && (
        <Card className="px-3 pb-2">
          <CardTitle className="px-1">Popular stocks</CardTitle>
          <ul className="mt-1 divide-y divide-line">
            {data.popular.map((q) => (
              <QuoteRow key={q.symbol} quote={q} receivedAt={dataUpdatedAt} />
            ))}
          </ul>
        </Card>
      )}

      {data.unavailable.length > 0 && (
        <p className="text-xs text-slate" role="status">
          Unavailable right now:{" "}
          {data.unavailable.map((u) => `${u.symbol} (${u.reason.replaceAll("_", " ")})`).join(", ")}
        </p>
      )}

      {nothingConfigured && (
        <StateMessage
          title="Search to get started"
          description="No benchmark or popular symbols are configured on the API server (MARKET_OVERVIEW_SYMBOLS, POPULAR_SYMBOLS)."
        />
      )}
    </div>
  );
}
