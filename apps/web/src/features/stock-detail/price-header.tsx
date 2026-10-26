"use client";

import { ApiErrorState } from "@/components/market/api-error-state";
import { FreshnessBadge } from "@/components/market/freshness-badge";
import { PriceChange } from "@/components/market/price-change";
import { SymbolAvatar } from "@/components/stocks/symbol-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPrice } from "@/lib/format";
import type { useQuote } from "@/services/api/queries";

export function PriceHeader({
  symbol,
  query,
}: {
  symbol: string;
  query: ReturnType<typeof useQuote>;
}) {
  const { data: quote, error, isPending, refetch, dataUpdatedAt } = query;

  if (isPending) {
    return (
      <div aria-busy="true" aria-label="กำลังโหลดราคา" className="flex items-center gap-3">
        <SymbolAvatar symbol={symbol} size="lg" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-8 w-40" />
        </div>
      </div>
    );
  }
  if (!quote) return <ApiErrorState error={error} onRetry={() => void refetch()} />;

  return (
    <section aria-label={`ราคา ${symbol}`} className="space-y-2">
      <div className="flex items-center gap-3">
        <SymbolAvatar symbol={symbol} size="lg" />
        <div className="min-w-0">
          <h1 className="truncate font-display text-lg font-bold text-ink">
            {quote.name || symbol}
          </h1>
          <p className="text-xs text-slate">
            {symbol} · {quote.exchange} · {quote.currency}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="tabular font-display text-4xl font-bold text-ink">
          {formatPrice(quote.price, quote.currency)}
        </p>
        <PriceChange
          change={quote.change}
          changePercent={quote.changePercent}
          className="text-base"
        />
      </div>
      <FreshnessBadge
        freshness={quote.freshness}
        isMarketOpen={quote.isMarketOpen}
        receivedAt={dataUpdatedAt}
      />
    </section>
  );
}
