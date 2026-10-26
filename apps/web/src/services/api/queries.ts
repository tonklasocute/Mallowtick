"use client";

import { keepPreviousData, QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";

import { QUOTE_REFRESH_MS } from "@/lib/config";
import type { ChartRange, Quote } from "@/types/api";

import { isApiError } from "./client";
import { endpoints } from "./endpoints";

/** Query keys. Quotes live under one key per symbol so every screen shares them. */
export const queryKeys = {
  health: ["health"] as const,
  marketStatus: ["market-status"] as const,
  overview: ["overview"] as const,
  search: (q: string) => ["search", q.toLowerCase()] as const,
  quote: (symbol: string) => ["quote", symbol] as const,
  quotes: (symbols: string[]) => ["quotes", ...symbols] as const,
  candles: (symbol: string, range: ChartRange) => ["candles", symbol, range] as const,
  /** Candles plus warm-up bars for indicators; a separate entry from plain candles. */
  chartCandles: (symbol: string, range: ChartRange) =>
    ["candles", symbol, range, "warmup"] as const,
  levels: (symbol: string, range: ChartRange) => ["levels", symbol, range] as const,
};

/** Errors that will not resolve by retrying immediately. */
const NO_RETRY = new Set([
  "invalid_request",
  "not_found",
  "provider_not_configured",
  "rate_limited",
  "provider_auth_failed",
  "provider_not_entitled",
]);

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (count, err) => !(isApiError(err) && NO_RETRY.has(err.code)) && count < 2,
        refetchOnWindowFocus: true,
      },
    },
  });
}

/** Seeds per-symbol quote entries from a batch so detail screens reuse them. */
function seedQuotes(client: QueryClient, quotes: Quote[]) {
  for (const q of quotes) client.setQueryData(queryKeys.quote(q.symbol), q);
}

export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: ({ signal }) => endpoints.health(signal),
    staleTime: 60_000,
  });
}

export function useMarketStatus() {
  return useQuery({
    queryKey: queryKeys.marketStatus,
    queryFn: ({ signal }) => endpoints.marketStatus(signal),
    refetchInterval: 5 * 60_000,
  });
}

export function useMarketOverview() {
  const client = useQueryClient();
  return useQuery({
    queryKey: queryKeys.overview,
    queryFn: async ({ signal }) => {
      const ov = await endpoints.overview(signal);
      seedQuotes(client, [...ov.benchmarks, ...ov.popular]);
      return ov;
    },
    refetchInterval: QUOTE_REFRESH_MS,
  });
}

export function useSearch(query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: queryKeys.search(q),
    queryFn: ({ signal }) => endpoints.search(q, signal),
    enabled: q.length > 0,
    staleTime: 5 * 60_000,
  });
}

export function useQuote(symbol: string) {
  return useQuery({
    queryKey: queryKeys.quote(symbol),
    queryFn: ({ signal }) => endpoints.quote(symbol, signal),
    refetchInterval: QUOTE_REFRESH_MS,
  });
}

export function useQuotes(symbols: string[]) {
  const client = useQueryClient();
  return useQuery({
    queryKey: queryKeys.quotes(symbols),
    queryFn: async ({ signal }) => {
      const batch = await endpoints.quotes(symbols, signal);
      seedQuotes(client, batch.quotes);
      return batch;
    },
    enabled: symbols.length > 0,
    refetchInterval: QUOTE_REFRESH_MS,
    placeholderData: keepPreviousData,
  });
}

/** Chart candles with warm-up bars for EMA; costs the same provider credit as plain candles. */
export function useCandles(symbol: string, range: ChartRange) {
  return useQuery({
    queryKey: queryKeys.chartCandles(symbol, range),
    queryFn: ({ signal }) => endpoints.candles(symbol, range, signal, true),
    // Intraday bars change during the session; longer ranges are refreshed on focus only.
    refetchInterval: range === "1d" ? 2 * QUOTE_REFRESH_MS : false,
    staleTime: range === "1d" ? 60_000 : 5 * 60_000,
    placeholderData: keepPreviousData,
  });
}

/**
 * The next scheduled earnings report. Optional data: without a vendor that
 * publishes a calendar the request fails, and the UI simply shows nothing.
 */
export function useEarnings(symbol: string) {
  return useQuery({
    queryKey: ["earnings", symbol] as const,
    queryFn: ({ signal }) => endpoints.earnings(symbol, signal),
    staleTime: 6 * 60 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useLevels(symbol: string, range: ChartRange) {
  return useQuery({
    queryKey: queryKeys.levels(symbol, range),
    queryFn: ({ signal }) => endpoints.levels(symbol, range, signal),
    refetchInterval: range === "1d" ? 2 * QUOTE_REFRESH_MS : false,
    staleTime: range === "1d" ? 60_000 : 5 * 60_000,
    placeholderData: keepPreviousData,
  });
}

/**
 * Intraday points for compact sparklines. Fetched once and kept for a while to
 * respect provider credit limits; a failure simply hides the sparkline. Each
 * symbol costs a provider credit, so lists pass `enabled` only for visible rows.
 */
export function useSparkline(symbol: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.candles(symbol, "1d"),
    queryFn: ({ signal }) => endpoints.candles(symbol, "1d", signal),
    enabled,
    staleTime: 10 * 60_000,
    // One retry when credits ran out, after the minute resets (Retry-After).
    retry: (count, err) => count < 1 && isApiError(err) && err.code === "rate_limited",
    retryDelay: (_, err) => (isApiError(err) ? (err.retryAfterSeconds ?? 60) : 60) * 1000,
    refetchOnWindowFocus: false,
  });
}
