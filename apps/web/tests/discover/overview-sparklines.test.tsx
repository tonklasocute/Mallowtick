import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MarketOverview } from "@/features/discover/market-overview";
import type { CandleSeries, MarketOverview as Overview } from "@/types/api";

import { apiError, freshness, ok, quote } from "../fixtures";
import { renderWithProviders } from "../render";

afterEach(() => vi.unstubAllGlobals());

/** The first benchmark is the hero; the second is a tile. `change` is today's change. */
function overview(change = 1.86): Overview {
  return {
    benchmarks: [
      quote({ symbol: "SPY", name: "SPDR S&P 500 ETF Trust", price: 759.97 }),
      quote({ symbol: "QQQ", name: "Invesco QQQ Trust", price: 704.4, change }),
    ],
    popular: [quote({ symbol: "AAPL", change })],
    unavailable: [],
  };
}

/** Serves the overview, and candles through `candles` (unavailable by default). */
function mockApi(
  candles: (symbol: string, range: string) => Response = () => apiError(429, "rate_limited"),
  ov: Overview = overview(),
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/api/v1/market/overview") return ok(ov);
      const m = url.pathname.match(/^\/api\/v1\/stocks\/([^/]+)\/candles$/);
      if (m) return candles(decodeURIComponent(m[1]!), url.searchParams.get("range") ?? "");
      return apiError(404, "not_found");
    }),
  );
}

const candleRequests = () =>
  vi
    .mocked(fetch)
    .mock.calls.map(([u]) => String(u))
    .filter((u) => u.includes("/candles"));

/** The 1M range as the API sends it without warm-up: one bar per session. */
function dailySeries(symbol: string, closes: number[]): CandleSeries {
  return {
    symbol,
    interval: "1day",
    exchangeTimezone: "America/New_York",
    candles: closes.map((close, i) => ({
      time: new Date(Date.UTC(2026, 9, i + 1, 4)).toISOString(),
      open: close,
      high: close,
      low: close,
      close,
      volume: null,
    })),
    range: "1m",
    freshness: freshness(),
  };
}

/** An IntersectionObserver whose targets come on screen only when the test says so. */
function mockIntersectionObserver() {
  const watched = new Map<Element, () => void>();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      readonly callback: IntersectionObserverCallback;
      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
      }
      observe(target: Element) {
        watched.set(target, () =>
          this.callback(
            [{ isIntersecting: true, target } as IntersectionObserverEntry],
            this as never,
          ),
        );
      }
      disconnect() {}
    },
  );
  /** Brings every watched element inside `area` on screen. */
  return (area: Element) =>
    act(() => {
      for (const [target, show] of watched) if (area.contains(target)) show();
    });
}

const benchmarksRegion = () => screen.findByRole("region", { name: "ดัชนีอ้างอิงตลาด" });
const popularRegion = () => screen.getByRole("region", { name: "หุ้นยอดนิยม" });
const tileOf = (symbol: string) =>
  within(screen.getByRole("region", { name: "ดัชนีอ้างอิงตลาด" })).getByRole("link", {
    name: new RegExp(`^${symbol}`),
  });
const rowOf = (symbol: string) =>
  within(popularRegion())
    .getByRole("link", { name: new RegExp(`^${symbol}`) })
    .closest("li")!;
const lineOf = (el: Element) => el.querySelector("polyline")?.closest("svg") ?? null;

describe("Discover sparklines", () => {
  it("loads the hero's day line at once and the month lines only once they are on screen", async () => {
    const reveal = mockIntersectionObserver();
    mockApi();
    renderWithProviders(<MarketOverview />);

    const benchmarks = await benchmarksRegion();
    await waitFor(() => expect(candleRequests()).toEqual(["/api/v1/stocks/SPY/candles?range=1d"]));

    reveal(benchmarks);
    await waitFor(() =>
      expect(candleRequests()).toEqual([
        "/api/v1/stocks/SPY/candles?range=1d",
        "/api/v1/stocks/QQQ/candles?range=1m",
      ]),
    );

    reveal(popularRegion());
    await waitFor(() => expect(candleRequests()).toContain("/api/v1/stocks/AAPL/candles?range=1m"));
    // The hero keeps its intraday line: no month of SPY is ever asked for.
    expect(candleRequests()).not.toContain("/api/v1/stocks/SPY/candles?range=1m");
  });

  it.each([
    { line: "rises", closes: [700, 702, 704.4], change: -1.2, stroke: "stroke-up" },
    { line: "falls", closes: [710, 708, 704.4], change: 1.86, stroke: "stroke-down" },
    {
      line: "ends where it began",
      closes: [704.4, 707, 704.4],
      change: 1.86,
      stroke: "stroke-slate",
    },
  ])(
    "colours the tile and row month lines by the line itself when it $line, not by today's change",
    async ({ closes, change, stroke }) => {
      mockApi(
        (symbol, range) =>
          range === "1m" ? ok(dailySeries(symbol, closes)) : apiError(429, "rate_limited"),
        overview(change),
      );
      renderWithProviders(<MarketOverview />);
      await benchmarksRegion();

      await waitFor(() => expect(lineOf(tileOf("QQQ"))).not.toBeNull());
      expect(lineOf(tileOf("QQQ"))).toHaveClass(stroke, "w-full");
      // The tile says the line is one month, unlike the hero's day line.
      expect(within(tileOf("QQQ")).getByText("1 เดือน")).toBeInTheDocument();

      await waitFor(() => expect(lineOf(rowOf("AAPL"))).not.toBeNull());
      expect(lineOf(rowOf("AAPL"))).toHaveClass(stroke);
      // One point per daily close.
      expect(
        rowOf("AAPL").querySelector("polyline")!.getAttribute("points")!.split(" "),
      ).toHaveLength(3);
    },
  );

  it("keeps rate-limited month lines hidden, retries them once, and shows no error", async () => {
    // A tiny Retry-After so the one retry happens within the test.
    mockApi(() => apiError(429, "rate_limited", "error", { "Retry-After": "0.01" }));
    renderWithProviders(<MarketOverview />);
    await benchmarksRegion();

    const monthRequests = () => candleRequests().filter((u) => u.endsWith("range=1m"));
    await waitFor(() =>
      expect(monthRequests().sort()).toEqual([
        "/api/v1/stocks/AAPL/candles?range=1m",
        "/api/v1/stocks/AAPL/candles?range=1m",
        "/api/v1/stocks/QQQ/candles?range=1m",
        "/api/v1/stocks/QQQ/candles?range=1m",
      ]),
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(monthRequests()).toHaveLength(4); // only one retry each

    expect(lineOf(tileOf("QQQ"))).toBeNull();
    expect(lineOf(rowOf("AAPL"))).toBeNull();
    expect(screen.queryByText("1 เดือน")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("เกินโควตาการเรียกข้อมูล")).toBeNull();
    // Prices are still there.
    expect(within(tileOf("QQQ")).getByText((_, el) => el?.textContent === "$704.40")).toBeVisible();
  });
});
