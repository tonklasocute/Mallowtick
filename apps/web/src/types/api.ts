// Types mirroring the Go API's JSON responses (see docs/api.md).

export type Latency = "realtime" | "delayed" | "eod" | "unknown";

export interface Freshness {
  provider: string;
  /** Operator-declared delivery latency of the provider plan. */
  latency: Latency;
  /** Provider timestamp of the data, when reported. */
  asOf: string | null;
  /** When the API server received the data from the provider. */
  fetchedAt: string;
  /** True when the provider failed and an older cached value is served. */
  stale: boolean;
}

export interface Quote {
  symbol: string;
  name: string;
  exchange: string;
  currency: string;
  /** https URL of the company logo; empty when the vendor has none (ETFs). */
  logo: string;
  price: number;
  open: number | null;
  high: number | null;
  low: number | null;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  fiftyTwoWeek: { low: number; high: number } | null;
  isMarketOpen: boolean | null;
  asOf: string | null;
  freshness: Freshness;
}

export interface UnavailableSymbol {
  symbol: string;
  reason: ApiErrorCode;
  /** Overview section the symbol belongs to (overview responses only). */
  group?: "benchmark" | "popular";
}

export interface QuoteBatch {
  quotes: Quote[];
  unavailable: UnavailableSymbol[];
}

export interface MarketOverview {
  benchmarks: Quote[];
  popular: Quote[];
  unavailable: UnavailableSymbol[];
}

/** How many baht one US dollar costs (`/fx/usd-thb`). */
export interface ExchangeRate {
  pair: string;
  rate: number;
  asOf: string | null;
  freshness: Freshness;
}

/** Periods of `/market/sectors` returns: the session, 5 sessions, 13 weeks, year to date, 52 weeks. */
export type SectorPeriod = "1d" | "1w" | "3m" | "ytd" | "1y";

/** Price returns in percent per period; null when the vendor reported none. */
export type PriceReturns = Record<SectorPeriod, number | null>;

export interface SectorPerformance {
  /** Stable English key such as "technology"; absent for the benchmark. */
  sector?: string;
  symbol: string;
  returns: PriceReturns;
}

export interface SectorsResult {
  /** SPY; null when it could not be fetched. */
  benchmark: SectorPerformance | null;
  sectors: SectorPerformance[];
  unavailable: UnavailableSymbol[];
  freshness: Freshness;
}

export interface Instrument {
  symbol: string;
  name: string;
  exchange: string;
  micCode?: string;
  currency?: string;
  type?: string;
  country?: string;
  /** https URL of the company logo, when the vendor has one. */
  logo?: string;
}

export interface SearchResponse {
  query: string;
  results: Instrument[];
}

export const CHART_RANGES = ["1d", "1w", "1m", "3m", "1y", "5y"] as const;
export type ChartRange = (typeof CHART_RANGES)[number];

export interface Candle {
  /** Bar open time, RFC 3339. */
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export interface CandleSeries {
  symbol: string;
  interval: string;
  currency?: string;
  exchangeTimezone: string;
  candles: Candle[];
  /** Earlier bars for indicator warm-up; present only when requested. */
  warmup?: Candle[];
  range: ChartRange;
  freshness: Freshness;
}

export interface Level {
  type: "support" | "resistance";
  price: number;
  zoneLow: number;
  zoneHigh: number;
  touches: number;
  /** Weighted score in [0, 1]. */
  strength: number;
  firstTouchAt: string;
  lastTouchAt: string;
}

export interface LevelsResponse {
  symbol: string;
  range: ChartRange;
  interval: string;
  status: "ok" | "insufficient_data";
  levels: Level[];
  referencePrice: number;
  atr: number;
  tolerance: number;
  candlesUsed: number;
  candlesDropped: number;
  swingHighs: number;
  swingLows: number;
  asOf: string;
  method: {
    name: string;
    description: string;
    parameters: {
      swingWindow: number;
      atrPeriod: number;
      clusterAtrMultiple: number;
      maxLevelsPerSide: number;
    };
  };
  computedAt: string;
  disclaimer: string;
  freshness: Freshness;
}

export interface MarketStatus {
  exchange: string;
  name: string;
  isOpen: boolean;
  opensInSeconds: number | null;
  closesInSeconds: number | null;
  freshness: Freshness;
}

/** Kinds of market data; each may come from a different vendor. */
export type DataKind =
  "quotes" | "search" | "candles" | "status" | "earnings" | "fundamentals" | "fx" | "news";

/** A vendor behind one kind of data, with the latency the operator declared for its plan. */
export interface DataSource {
  name: string;
  configured: boolean;
  /** Absent from APIs older than the per-vendor declaration; the provider's applies then. */
  latency?: Latency;
}

export interface VendorStats {
  state: "closed" | "open" | "half-open";
  calls: number;
  failures: number;
  consecutiveFailures: number;
  lastFailureAt: string | null;
  lastFailure?: string;
}

export interface Health {
  status: string;
  provider: {
    name: string;
    configured: boolean;
    latency: Latency;
    /**
     * The vendor behind each kind of data; "earnings" and "fundamentals" are absent when no
     * vendor publishes them.
     */
    sources?: Partial<Record<DataKind, DataSource>>;
    /** Each vendor's call outcomes; "open" means the API stopped calling it after failures. */
    vendors?: Record<string, VendorStats>;
  };
  time: string;
}

export interface EarningsEvent {
  symbol: string;
  /** Only when the API already knew it; it never looks names up for the calendar. */
  name?: string;
  logo?: string;
  /** Report date, YYYY-MM-DD, in US market time. */
  date: string;
  /** "bmo" before the open, "amc" after the close, "dmh" during the session, "" when not announced. */
  hour: string;
  /** Fiscal quarter and year. */
  quarter?: number;
  year?: number;
  epsEstimate: number | null;
  revenueEstimate: number | null;
  /** Null until the company has reported. */
  epsActual: number | null;
  revenueActual: number | null;
}

export interface EarningsCalendar {
  from: string;
  to: string;
  /** The New York date the API used; past, today and upcoming are split on it. */
  today: string;
  /** By date, then before the open, during the session, after the close, unknown. */
  events: EarningsEvent[];
  /** The vendor's row limit may have left reports out. */
  truncated: boolean;
  freshness: Freshness;
}

export interface SymbolEarnings {
  symbol: string;
  today: string;
  /** Earliest report from today that has no actuals yet. */
  next: EarningsEvent | null;
  /** Latest report with actuals, or one already past. */
  last: EarningsEvent | null;
  freshness: Freshness;
}

/** A reported figure against its estimate; "" when either is missing. */
export type EarningsOutcome = "beat" | "miss" | "inline" | "";

export interface EarningsQuarter extends EarningsSurprise {
  /** From the calendar, YYYY-MM-DD; "" for quarters it no longer lists. */
  reportDate: string;
  hour: string;
  epsResult: EarningsOutcome;
  /** Only for the quarter the calendar still lists (the latest), matched by fiscal quarter. */
  revenueActual: number | null;
  revenueEstimate: number | null;
  revenueSurprisePercent: number | null;
  revenueResult: EarningsOutcome;
}

export interface EarningsDetail {
  symbol: string;
  /** Newest first; empty for ETFs. */
  quarters: EarningsQuarter[];
  epsRecord: { compared: number; beats: number; misses: number; inline: number };
  freshness: Freshness;
}

export interface EarningsResult {
  symbol: string;
  /** Null when no report is scheduled within the vendor's calendar. */
  next: EarningsEvent | null;
  freshness: Freshness;
}

/**
 * Vendor ratios. Money is in the listing currency, percentages are in percent units
 * (12.5 means 12.5%), and TTM means the trailing twelve months. Null when not reported.
 */
export interface KeyMetrics {
  marketCap: number | null;
  enterpriseValue: number | null;
  peTTM: number | null;
  psTTM: number | null;
  pb: number | null;
  epsTTM: number | null;
  revenueGrowthYoY: number | null;
  /** Five-year compound annual growth rate. */
  revenueGrowth5Y: number | null;
  epsGrowthYoY: number | null;
  grossMarginTTM: number | null;
  operatingMarginTTM: number | null;
  netMarginTTM: number | null;
  roeTTM: number | null;
  currentRatio: number | null;
  debtToEquity: number | null;
  dividendYield: number | null;
  payoutRatioTTM: number | null;
  beta: number | null;
  /** Price returns in percent, and the S&P 500's over the same period. */
  priceReturnYTD: number | null;
  priceReturn1Y: number | null;
  sp500ReturnYTD: number | null;
  sp500Return1Y: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  /** YYYY-MM-DD, empty when unknown. */
  fiftyTwoWeekHighDate: string;
  fiftyTwoWeekLowDate: string;
}

export interface Fundamentals {
  symbol: string;
  /** Vendor's industry name, in English; empty for ETFs. */
  industry: string;
  country: string;
  /** YYYY-MM-DD, empty when unknown. */
  ipoDate: string;
  website: string;
  sharesOutstanding: number | null;
  metrics: KeyMetrics;
  freshness: Freshness;
}

/** One reported quarter: actual EPS against the consensus estimate. */
export interface EarningsSurprise {
  /** End of the fiscal quarter, YYYY-MM-DD. */
  period: string;
  /** Fiscal year and quarter; they can differ from the calendar (Apple's Q3 ends in June). */
  year: number;
  quarter: number;
  actual: number | null;
  estimate: number | null;
  surprise: number | null;
  /** Surprise as a percentage of the estimate's size; positive means better than expected. */
  surprisePercent: number | null;
}

export interface EarningsHistory {
  symbol: string;
  /** Newest first; empty for ETFs. */
  quarters: EarningsSurprise[];
  freshness: Freshness;
}

/** Analyst ratings in effect for one month. */
export interface RecommendationTrend {
  /** First day of the month, YYYY-MM-DD. */
  period: string;
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
}

export interface Recommendations {
  symbol: string;
  /** Newest first; empty for ETFs. */
  trends: RecommendationTrend[];
  freshness: Freshness;
}

export type ApiErrorCode =
  | "invalid_request"
  | "not_found"
  | "provider_not_configured"
  | "rate_limited"
  | "too_many_requests"
  | "provider_auth_failed"
  | "provider_not_entitled"
  | "timeout"
  | "provider_unavailable"
  | "internal_error"
  | "method_not_allowed"
  // Client-side codes:
  | "api_unreachable"
  | "network_error"
  | "bad_response";

/** One publication of a story; grouped duplicates keep each publisher's credit and link. */
export interface NewsSource {
  id: string;
  /** Publisher as the vendor names it; "" when it gave none. */
  source: string;
  url: string;
  publishedAt: string;
}

/** A story as the vendor published it: nothing is rewritten. */
export interface NewsArticle {
  id: string;
  headline: string;
  /** "" when the vendor gives none. */
  summary: string;
  /** The vendor's link (Finnhub's redirect to the publisher). */
  url: string;
  source: string;
  publishedAt: string;
  /** The vendor's category: "company", "top news", "business", "merger", … */
  category: string;
  /** Tickers the vendor tied the story to. */
  related: string[];
  /** Every publication grouped into this story, the article itself first. */
  sources: NewsSource[];
  provider: string;
}

export interface NewsPage {
  articles: NewsArticle[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
  /** Symbols whose news could not be included this time (e.g. rate_limited: asked again later). */
  unavailable: UnavailableSymbol[];
  freshness: Freshness;
}

export type MarketNewsCategory = "general" | "merger";

/** "amount" is money in the company's reporting currency (earnings figures; not always USD). */
export type FactUnit =
  "usd" | "amount" | "percent" | "shares" | "ratio" | "date" | "text" | "count";

/** A value an insight rests on; numbers in `value`, dates and words in `text`. */
export interface InsightFact {
  label: string;
  value: number | null;
  text?: string;
  unit: FactUnit;
}

/** A rule-based observation from vendor data. It states facts, never advice or causes. */
export interface Insight {
  id: string;
  type: string;
  scope: "market" | "symbol" | "portfolio";
  symbol?: string;
  title: string;
  explanation: string;
  /** The rule that produced it. */
  method: string;
  facts: InsightFact[];
  /** Vendor ids, plus "mallowtick" when a value was computed. */
  sources: string[];
  asOf: string | null;
  completeness: "complete" | "partial";
  /** "high": vendor-reported values; "medium": computed from vendor data. */
  reliability: "high" | "medium";
  tone: "up" | "down" | "neutral";
  priority: number;
}

export interface CoverageGap {
  data: string;
  /** An API error code; rate_limited means it comes with a later request. */
  reason: string;
}

export interface Coverage {
  /** "" for the market as a whole. */
  symbol: string;
  missing: CoverageGap[];
}

export interface Briefing {
  today: string;
  generatedAt: string;
  market: Insight[];
  insights: Insight[];
  thingsToWatch: Insight[];
  coverage: Coverage[];
  disclaimer: string;
}

export interface CompareItem {
  symbol: string;
  name: string;
  logo: string;
  currency: string;
  price: number | null;
  changePercent: number | null;
  asOf: string | null;
  fundamentals: Omit<Fundamentals, "freshness"> | null;
  epsRecord: EarningsDetail["epsRecord"] | null;
  lastQuarter: EarningsQuarter | null;
  ratings: RecommendationTrend | null;
  sources: string[];
  missing: CoverageGap[];
}

export interface Comparison {
  generatedAt: string;
  items: CompareItem[];
  disclaimer: string;
}
