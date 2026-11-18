import type {
  Briefing,
  CandleSeries,
  Comparison,
  EarningsCalendar,
  EarningsDetail,
  ChartRange,
  EarningsHistory,
  EarningsResult,
  ExchangeRate,
  Fundamentals,
  Health,
  LevelsResponse,
  MarketOverview,
  MarketNewsCategory,
  MarketStatus,
  NewsArticle,
  NewsPage,
  Quote,
  QuoteBatch,
  Recommendations,
  SearchResponse,
  SectorsResult,
  SymbolEarnings,
} from "@/types/api";

import { apiGet } from "./client";

type Signal = AbortSignal | undefined;
const enc = encodeURIComponent;

/** Typed endpoint functions. UI code goes through the query hooks instead. */
export const endpoints = {
  health: (signal?: Signal) => apiGet<Health>("/health", undefined, { signal }),
  marketStatus: (signal?: Signal) => apiGet<MarketStatus>("/market/status", undefined, { signal }),
  overview: (signal?: Signal) => apiGet<MarketOverview>("/market/overview", undefined, { signal }),
  usdThb: (signal?: Signal) => apiGet<ExchangeRate>("/fx/usd-thb", undefined, { signal }),
  sectors: (signal?: Signal) => apiGet<SectorsResult>("/market/sectors", undefined, { signal }),
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
  earningsHistory: (symbol: string, signal?: Signal) =>
    apiGet<EarningsHistory>(`/stocks/${enc(symbol)}/earnings/history`, undefined, { signal }),
  recommendations: (symbol: string, signal?: Signal) =>
    apiGet<Recommendations>(`/stocks/${enc(symbol)}/recommendations`, undefined, { signal }),
  fundamentals: (symbol: string, signal?: Signal) =>
    apiGet<Fundamentals>(`/stocks/${enc(symbol)}/fundamentals`, undefined, { signal }),
  earningsCalendar: (from: string, to: string, symbols: string[] = [], signal?: Signal) =>
    apiGet<EarningsCalendar>(
      "/earnings/calendar",
      { from, to, symbols: symbols.length > 0 ? symbols.join(",") : undefined },
      { signal },
    ),
  symbolEarnings: (symbol: string, signal?: Signal) =>
    apiGet<SymbolEarnings>(`/earnings/${enc(symbol)}`, undefined, { signal }),
  earningsDetail: (symbol: string, signal?: Signal) =>
    apiGet<EarningsDetail>(`/earnings/${enc(symbol)}/history`, undefined, { signal }),
  news: (
    query: { symbols?: string[]; category?: MarketNewsCategory; page?: number; limit?: number },
    signal?: Signal,
  ) =>
    apiGet<NewsPage>(
      "/news",
      {
        symbols: query.symbols?.length ? query.symbols.join(",") : undefined,
        category: query.symbols?.length ? undefined : query.category,
        page: query.page ? String(query.page) : undefined,
        limit: query.limit ? String(query.limit) : undefined,
      },
      { signal },
    ),
  article: (id: string, signal?: Signal) =>
    apiGet<NewsArticle>(`/news/${enc(id)}`, undefined, { signal }),
  briefing: (symbols: string[], signal?: Signal) =>
    apiGet<Briefing>(
      "/research/briefing",
      { symbols: symbols.length > 0 ? symbols.join(",") : undefined },
      { signal },
    ),
  compare: (symbols: string[], signal?: Signal) =>
    apiGet<Comparison>("/research/compare", { symbols: symbols.join(",") }, { signal }),
  levels: (symbol: string, range: ChartRange, signal?: Signal) =>
    apiGet<LevelsResponse>(`/stocks/${enc(symbol)}/levels`, { range }, { signal }),
};
