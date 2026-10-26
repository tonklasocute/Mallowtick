import type {
  CandleSeries,
  ChartRange,
  EarningsResult,
  Health,
  LevelsResponse,
  MarketOverview,
  MarketStatus,
  Quote,
  QuoteBatch,
  SearchResponse,
} from "@/types/api";

import { apiGet } from "./client";

type Signal = AbortSignal | undefined;
const enc = encodeURIComponent;

/** Typed endpoint functions. UI code goes through the query hooks instead. */
export const endpoints = {
  health: (signal?: Signal) => apiGet<Health>("/health", undefined, { signal }),
  marketStatus: (signal?: Signal) => apiGet<MarketStatus>("/market/status", undefined, { signal }),
  overview: (signal?: Signal) => apiGet<MarketOverview>("/market/overview", undefined, { signal }),
  search: (q: string, signal?: Signal) =>
    apiGet<SearchResponse>("/stocks/search", { q }, { signal }),
  quote: (symbol: string, signal?: Signal) =>
    apiGet<Quote>(`/stocks/${enc(symbol)}/quote`, undefined, { signal }),
  quotes: (symbols: string[], signal?: Signal) =>
    apiGet<QuoteBatch>("/stocks/quotes", { symbols: symbols.join(",") }, { signal }),
  candles: (symbol: string, range: ChartRange, signal?: Signal, warmup = false) =>
    apiGet<CandleSeries>(
      `/stocks/${enc(symbol)}/candles`,
      { range, warmup: warmup ? "true" : undefined },
      { signal },
    ),
  earnings: (symbol: string, signal?: Signal) =>
    apiGet<EarningsResult>(`/stocks/${enc(symbol)}/earnings`, undefined, { signal }),
  levels: (symbol: string, range: ChartRange, signal?: Signal) =>
    apiGet<LevelsResponse>(`/stocks/${enc(symbol)}/levels`, { range }, { signal }),
};
