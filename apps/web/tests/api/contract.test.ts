/**
 * The Go API pins every endpoint's JSON in services/api/internal/transport/http/testdata/contract.
 * Assigning those files to the TypeScript types below makes `tsc` (make lint) fail when the API
 * drops a field, renames one, or changes its type. JSON imports widen string unions to string,
 * so the types are compared through Loose, which does the same.
 */
import { describe, expect, it } from "vitest";

import type {
  Briefing,
  CandleSeries,
  Comparison,
  EarningsCalendar,
  EarningsDetail,
  EarningsHistory,
  EarningsResult,
  ExchangeRate,
  Fundamentals,
  Health,
  Instrument,
  LevelsResponse,
  MarketOverview,
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

import earningsCalendar from "../../../../services/api/internal/transport/http/testdata/contract/earnings-calendar.json";
import earningsDetail from "../../../../services/api/internal/transport/http/testdata/contract/earnings-symbol-history.json";
import symbolEarnings from "../../../../services/api/internal/transport/http/testdata/contract/earnings-symbol.json";
import fxUsdThb from "../../../../services/api/internal/transport/http/testdata/contract/fx-usd-thb.json";
import newsArticle from "../../../../services/api/internal/transport/http/testdata/contract/news-article.json";
import news from "../../../../services/api/internal/transport/http/testdata/contract/news.json";
import researchBriefing from "../../../../services/api/internal/transport/http/testdata/contract/research-briefing.json";
import researchCompare from "../../../../services/api/internal/transport/http/testdata/contract/research-compare.json";
import health from "../../../../services/api/internal/transport/http/testdata/contract/health.json";
import overview from "../../../../services/api/internal/transport/http/testdata/contract/market-overview.json";
import sectors from "../../../../services/api/internal/transport/http/testdata/contract/market-sectors.json";
import status from "../../../../services/api/internal/transport/http/testdata/contract/market-status.json";
import candles from "../../../../services/api/internal/transport/http/testdata/contract/stock-candles.json";
import earningsHistory from "../../../../services/api/internal/transport/http/testdata/contract/stock-earnings-history.json";
import earnings from "../../../../services/api/internal/transport/http/testdata/contract/stock-earnings.json";
import fundamentals from "../../../../services/api/internal/transport/http/testdata/contract/stock-fundamentals.json";
import instrument from "../../../../services/api/internal/transport/http/testdata/contract/stock-instrument.json";
import levels from "../../../../services/api/internal/transport/http/testdata/contract/stock-levels.json";
import quote from "../../../../services/api/internal/transport/http/testdata/contract/stock-quote.json";
import recommendations from "../../../../services/api/internal/transport/http/testdata/contract/stock-recommendations.json";
import quotes from "../../../../services/api/internal/transport/http/testdata/contract/stocks-quotes.json";
import search from "../../../../services/api/internal/transport/http/testdata/contract/stocks-search.json";

/** T with string literal unions widened to string, as JSON imports type them. */
export type Loose<T> = T extends string
  ? string
  : T extends readonly (infer U)[]
    ? Loose<U>[]
    : T extends object
      ? { [K in keyof T]: Loose<T[K]> }
      : T;

// Compile-time checks: each line fails `tsc` when the fixture no longer fits the type.
const checks = {
  health: health.data satisfies Loose<Health>,
  status: status.data satisfies Loose<MarketStatus>,
  overview: overview.data satisfies Loose<MarketOverview>,
  sectors: sectors.data satisfies Loose<SectorsResult>,
  fx: fxUsdThb.data satisfies Loose<ExchangeRate>,
  search: search.data satisfies Loose<SearchResponse>,
  quotes: quotes.data satisfies Loose<QuoteBatch>,
  instrument: instrument.data satisfies Loose<Instrument>,
  quote: quote.data satisfies Loose<Quote>,
  candles: candles.data satisfies Loose<CandleSeries>,
  levels: levels.data satisfies Loose<LevelsResponse>,
  earnings: earnings.data satisfies Loose<EarningsResult>,
  earningsHistory: earningsHistory.data satisfies Loose<EarningsHistory>,
  fundamentals: fundamentals.data satisfies Loose<Fundamentals>,
  recommendations: recommendations.data satisfies Loose<Recommendations>,
  earningsCalendar: earningsCalendar.data satisfies Loose<EarningsCalendar>,
  symbolEarnings: symbolEarnings.data satisfies Loose<SymbolEarnings>,
  earningsDetail: earningsDetail.data satisfies Loose<EarningsDetail>,
  news: news.data satisfies Loose<NewsPage>,
  newsArticle: newsArticle.data satisfies Loose<NewsArticle>,
  researchBriefing: researchBriefing.data satisfies Loose<Briefing>,
  researchCompare: researchCompare.data satisfies Loose<Comparison>,
};

describe("API contract fixtures", () => {
  it("are all present", () => {
    for (const [name, value] of Object.entries(checks)) {
      expect(value, name).toBeTypeOf("object");
    }
  });
});
