"use client";

import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { IconButton } from "@/components/ui/button";
import { useWatchlist } from "@/features/watchlist/use-watchlist";
import { WatchlistToggle } from "@/features/watchlist/watchlist-toggle";
import { labelLevels } from "@/lib/levels";
import { useCandles, useLevels, useQuote } from "@/services/api/queries";
import type { ChartRange } from "@/types/api";

import { ChartPanel } from "./chart-panel";
import { KeyLevels } from "./key-levels";
import { PriceHeader } from "./price-header";
import { QuoteStats } from "./quote-stats";

export function StockDetailScreen({ symbol }: { symbol: string }) {
  const router = useRouter();
  const [range, setRange] = useState<ChartRange>("1d");
  const quote = useQuote(symbol);
  const candles = useCandles(symbol, range);
  const levelsQuery = useLevels(symbol, range);
  const watchlist = useWatchlist();

  const levels = useMemo(
    () =>
      levelsQuery.data ? labelLevels(levelsQuery.data.levels, levelsQuery.data.referencePrice) : [],
    [levelsQuery.data],
  );

  return (
    <>
      <PageHeader
        leading={
          <IconButton
            label="Back"
            onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))}
          >
            <ChevronLeft aria-hidden className="size-6" />
          </IconButton>
        }
        title={<p className="font-display text-lg font-bold text-ink">{symbol}</p>}
        trailing={<WatchlistToggle symbol={symbol} />}
      />
      <main className="pb-nav space-y-4 px-4">
        <PriceHeader symbol={symbol} query={quote} />
        {watchlist.error && (
          <p role="alert" className="rounded-xl bg-accent-soft px-3 py-2 text-sm text-down">
            {watchlist.error.message}
          </p>
        )}
        <ChartPanel range={range} onRangeChange={setRange} candles={candles} levels={levels} />
        <KeyLevels range={range} query={levelsQuery} levels={levels} />
        {quote.data && <QuoteStats quote={quote.data} />}
        <p className="px-1 text-[11px] leading-relaxed text-slate">
          For information only, not investment advice. Prices come from the configured market-data
          provider; levels are Mallowtick calculations.
        </p>
      </main>
    </>
  );
}
