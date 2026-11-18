"use client";

import { useMemo } from "react";

import { usePortfolio } from "@/features/portfolio/use-portfolio";
import { useWatchlist } from "@/features/watchlist/use-watchlist";

export interface MySymbols {
  /** Held stocks, in portfolio order. */
  holdings: string[];
  watchlist: string[];
  /** Holdings first, then the rest of the watchlist, without repeats. */
  all: string[];
  set: ReadonlySet<string>;
  isLoading: boolean;
}

/**
 * The symbols this device's user follows. They come from local storage only; screens send
 * them to the API as query filters, never with quantities or costs.
 */
export function useMySymbols(): MySymbols {
  const watchlist = useWatchlist();
  const { portfolio, isLoading } = usePortfolio();
  return useMemo(() => {
    const holdings = portfolio.holdings.map((h) => h.symbol);
    const all = [...new Set([...holdings, ...watchlist.symbols])];
    return {
      holdings,
      watchlist: watchlist.symbols,
      all,
      set: new Set(all),
      isLoading: isLoading || watchlist.isLoading,
    };
  }, [portfolio.holdings, watchlist.symbols, watchlist.isLoading, isLoading]);
}
