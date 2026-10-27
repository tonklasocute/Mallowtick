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
export type DataKind = "quotes" | "search" | "candles" | "status" | "earnings" | "fundamentals";

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
    sources?: Partial<Record<DataKind, { name: string; configured: boolean }>>;
  };
  time: string;
}

export interface EarningsEvent {
  symbol: string;
  /** Report date, YYYY-MM-DD, in US market time. */
  date: string;
  /** "bmo" before the open, "amc" after the close, "dmh" during the session, "" when not announced. */
  hour: string;
  quarter?: number;
  year?: number;
  epsEstimate: number | null;
  revenueEstimate: number | null;
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
