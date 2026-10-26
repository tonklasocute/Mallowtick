"use client";

import { Check, MinusCircle, Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Sparkline } from "@/components/charts/sparkline";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { ApiErrorState } from "@/components/market/api-error-state";
import { QuoteRow } from "@/components/stocks/quote-row";
import { SymbolAvatar } from "@/components/stocks/symbol-avatar";
import { UnavailableQuoteRow } from "@/components/stocks/unavailable-quote-row";
import { IconButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StateMessage } from "@/components/ui/state-message";
import { direction } from "@/lib/format";
import { unavailableReasonLabel } from "@/lib/unavailable-reason";
import { isApiError } from "@/services/api/client";
import { useQuotes, useSparkline } from "@/services/api/queries";
import type { Quote } from "@/types/api";

import { useWatchlist, useWatchlistRepository } from "./use-watchlist";

function RowSparkline({ quote }: { quote: Quote }) {
  const { data } = useSparkline(quote.symbol);
  if (!data || data.candles.length < 2) return null;
  return (
    <Sparkline
      candles={data.candles}
      trend={direction(quote.changePercent ?? quote.change)}
      className="hidden min-[360px]:block"
    />
  );
}

export function WatchlistScreen() {
  const wl = useWatchlist();
  const repo = useWatchlistRepository();
  const [editing, setEditing] = useState(false);
  const quotes = useQuotes(wl.symbols);

  const bySymbol = new Map(quotes.data?.quotes.map((q) => [q.symbol, q]));
  const reasons = new Map(quotes.data?.unavailable.map((u) => [u.symbol, u.reason]));
  const hasSymbols = wl.symbols.length > 0;

  return (
    <PageContainer>
      <PageHeader
        title="Watchlist"
        trailing={
          <>
            {hasSymbols && (
              <IconButton
                label={editing ? "Done editing" : "Edit watchlist"}
                aria-pressed={editing}
                onClick={() => setEditing((e) => !e)}
              >
                {editing ? (
                  <Check aria-hidden className="size-5" />
                ) : (
                  <Pencil aria-hidden className="size-5" />
                )}
              </IconButton>
            )}
            <Link
              href="/#search"
              aria-label="Add a stock"
              title="Add a stock"
              className="inline-flex size-10 items-center justify-center rounded-full text-mint-deep hover:bg-cream-deep"
            >
              <Plus aria-hidden className="size-6" />
            </Link>
          </>
        }
      />
      <main className="pb-nav space-y-3 px-4">
        {wl.error && (
          <p role="alert" className="rounded-xl bg-accent-soft px-3 py-2 text-sm text-down">
            {wl.error.message}
          </p>
        )}

        {wl.isLoading ? (
          <Card aria-busy="true" aria-label="Loading watchlist" className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </Card>
        ) : !hasSymbols ? (
          <Card>
            <StateMessage
              title="Your watchlist is empty"
              description="Tap the star on any stock to keep an eye on it here."
              action={
                <Link
                  href="/#search"
                  className="inline-flex min-h-10 items-center rounded-full bg-mint-deep px-4 text-sm font-semibold text-surface"
                >
                  Discover stocks
                </Link>
              }
            />
          </Card>
        ) : (
          <>
            {quotes.error && !quotes.data && (
              <ApiErrorState error={quotes.error} onRetry={() => void quotes.refetch()} compact />
            )}
            <Card className="px-3 py-1">
              <ul className="divide-y divide-line" aria-busy={quotes.isPending}>
                {wl.symbols.map((symbol) => {
                  const q = bySymbol.get(symbol);
                  const remove = editing ? (
                    <IconButton
                      label={`Remove ${symbol}`}
                      className="text-down"
                      onClick={() => wl.remove(symbol)}
                    >
                      <MinusCircle aria-hidden className="size-5" />
                    </IconButton>
                  ) : undefined;
                  if (q) {
                    return (
                      <QuoteRow
                        key={symbol}
                        quote={q}
                        receivedAt={quotes.dataUpdatedAt}
                        middle={<RowSparkline quote={q} />}
                        trailing={remove}
                      />
                    );
                  }
                  if (quotes.isPending) {
                    return (
                      <li key={symbol} className="flex items-center gap-3 py-2.5">
                        <SymbolAvatar symbol={symbol} />
                        <span className="flex-1 font-display font-semibold text-ink">{symbol}</span>
                        <Skeleton className="h-8 w-20" />
                        {remove}
                      </li>
                    );
                  }
                  const code =
                    reasons.get(symbol) ?? (isApiError(quotes.error) ? quotes.error.code : "");
                  return (
                    <UnavailableQuoteRow
                      key={symbol}
                      symbol={symbol}
                      reason={unavailableReasonLabel(code)}
                      trailing={remove}
                    />
                  );
                })}
              </ul>
            </Card>
          </>
        )}
        <p className="px-1 text-[11px] text-slate">{repo.storageDescription}</p>
      </main>
    </PageContainer>
  );
}
