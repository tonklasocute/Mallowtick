"use client";

import type { Ref } from "react";

import { ApiErrorState } from "@/components/market/api-error-state";
import { FreshnessChips } from "@/components/market/freshness-badge";
import { PriceText } from "@/components/market/price-text";
import { SymbolAvatar } from "@/components/stocks/symbol-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import type { useQuote } from "@/services/api/queries";

import { DeltaPill } from "./detail-ui";
import { EarningsBadge } from "./earnings-badge";

export function PriceHeader({
  symbol,
  query,
  priceRef,
}: {
  symbol: string;
  query: ReturnType<typeof useQuote>;
  /** The price line, so the page header can show the price once it scrolls away. */
  priceRef?: Ref<HTMLDivElement>;
}) {
  const { data: quote, error, isPending, refetch, dataUpdatedAt } = query;

  if (isPending) {
    return (
      <div aria-busy="true" aria-label="กำลังโหลดราคา" className="space-y-3.5">
        <div className="flex items-center gap-3">
          <SymbolAvatar symbol={symbol} size="lg" shape="tile" />
          <div className="space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-3 w-28" />
          </div>
        </div>
        <Skeleton className="h-10 w-48" />
      </div>
    );
  }
  if (!quote) return <ApiErrorState error={error} onRetry={() => void refetch()} />;

  return (
    <section aria-label={`ราคา ${symbol}`}>
      <div className="flex items-center gap-3">
        <SymbolAvatar symbol={symbol} logo={quote.logo} size="lg" shape="tile" />
        <div className="min-w-0">
          <h1 className="truncate font-display text-xl font-black text-ink">
            {quote.name || symbol}
          </h1>
          <p className="truncate font-display text-xs font-bold text-slate">
            {[symbol, quote.exchange, quote.currency].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>
      <div ref={priceRef} className="mt-3.5 flex flex-wrap items-center gap-2.5">
        <PriceText
          value={quote.price}
          currency={quote.currency}
          className="font-display text-[40px] leading-none font-black tracking-[-1px] text-ink"
        />
        <DeltaPill change={quote.change} changePercent={quote.changePercent} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <FreshnessChips
          freshness={quote.freshness}
          isMarketOpen={quote.isMarketOpen}
          receivedAt={dataUpdatedAt}
        />
        <EarningsBadge symbol={symbol} />
      </div>
    </section>
  );
}
