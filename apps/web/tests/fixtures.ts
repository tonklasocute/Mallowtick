// Deterministic test fixtures. Never imported by application code.
import type { Freshness, Quote } from "@/types/api";

export const NOW = new Date("2026-10-23T19:00:00Z"); // 3:00 PM ET, market open

export function freshness(overrides: Partial<Freshness> = {}): Freshness {
  return {
    provider: "twelvedata",
    latency: "realtime",
    asOf: "2026-10-23T18:59:00Z",
    fetchedAt: "2026-10-23T18:59:30Z",
    stale: false,
    ...overrides,
  };
}

export function quote(overrides: Partial<Quote> = {}): Quote {
  return {
    symbol: "AAPL",
    name: "Apple Inc.",
    exchange: "NASDAQ",
    currency: "USD",
    price: 189.32,
    open: 187.42,
    high: 189.76,
    low: 186.9,
    previousClose: 187.46,
    change: 1.86,
    changePercent: 0.99,
    volume: 52_400_000,
    fiftyTwoWeek: { low: 164.08, high: 199.62 },
    isMarketOpen: true,
    asOf: "2026-10-23T18:59:00Z",
    freshness: freshness(),
    ...overrides,
  };
}

/** A Response carrying the API's success envelope. */
export function ok(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

export function apiError(
  status: number,
  code: string,
  message = "error",
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify({ error: { code, message, requestId: "req-1" } }), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}
