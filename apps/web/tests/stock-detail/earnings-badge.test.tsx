import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EarningsBadge, formatEarningsDate } from "@/features/stock-detail/earnings-badge";
import { MoreScreen } from "@/features/more/more-screen";

import { apiError, freshness, ok } from "../fixtures";
import { renderWithProviders } from "../render";

afterEach(() => vi.unstubAllGlobals());

function mockApi(routes: Record<string, () => Response>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input), "http://localhost").pathname;
    return routes[path]?.() ?? apiError(404, "not_found");
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const NOW = new Date("2026-10-26T14:00:00Z");

function earnings(date: string, hour = "amc") {
  return ok({
    symbol: "AAPL",
    next: { symbol: "AAPL", date, hour, epsEstimate: 2.02, revenueEstimate: null },
    freshness: freshness({ provider: "finnhub" }),
  });
}

describe("EarningsBadge", () => {
  it("formats the calendar date in Thai without shifting the day", () => {
    expect(formatEarningsDate("2026-11-02")).toBe("2 พ.ย.");
  });

  it("shows the next report with its session", async () => {
    mockApi({ "/api/v1/stocks/AAPL/earnings": () => earnings("2026-11-02") });
    renderWithProviders(<EarningsBadge symbol="AAPL" now={NOW} />);
    expect(await screen.findByText(/ประกาศงบ 2 พ\.ย\. · หลังตลาดปิด/)).toBeInTheDocument();
  });

  it("shows nothing for a past date or when no calendar is available", async () => {
    const fetchMock = mockApi({ "/api/v1/stocks/AAPL/earnings": () => earnings("2026-10-20") });
    const { container, unmount } = renderWithProviders(<EarningsBadge symbol="AAPL" now={NOW} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    unmount();

    mockApi({ "/api/v1/stocks/AAPL/earnings": () => apiError(503, "provider_not_configured") });
    const second = renderWithProviders(<EarningsBadge symbol="AAPL" now={NOW} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(second.container).toBeEmptyDOMElement();
  });
});

describe("MoreScreen data sources", () => {
  it("lists the vendor behind each kind of data and credits both", async () => {
    // jsdom has no matchMedia; the screen uses it to detect the installed PWA.
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }));
    mockApi({
      "/api/v1/health": () =>
        ok({
          status: "ok",
          time: NOW.toISOString(),
          provider: {
            name: "finnhub+twelvedata",
            configured: true,
            latency: "unknown",
            sources: {
              quotes: { name: "finnhub", configured: true },
              search: { name: "finnhub", configured: true },
              candles: { name: "twelvedata", configured: true },
              status: { name: "twelvedata", configured: true },
              earnings: { name: "finnhub", configured: true },
            },
          },
        }),
    });
    renderWithProviders(<MoreScreen />);
    expect((await screen.findByText("ราคาล่าสุด")).nextSibling).toHaveTextContent("Finnhub");
    expect(screen.getByText("กราฟแท่งเทียน").nextSibling).toHaveTextContent("Twelve Data");
    expect(screen.getByText("วันประกาศงบ").nextSibling).toHaveTextContent("Finnhub");
    expect(screen.getByText(/ข้อมูลตลาดโดย Finnhub และ Twelve Data/)).toBeInTheDocument();
  });
});
