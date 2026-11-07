import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MoreScreen } from "@/features/more/more-screen";
import { CompanyNews } from "@/features/stock-detail/company-news";
import type { NewsArticle } from "@/types/api";

import { apiError, freshness, NOW, ok } from "../fixtures";
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

// Shaped like Finnhub's RKLB news on 2026-11-07, after the API's clean-up.
const BENZINGA: NewsArticle = {
  headline: "Rocket Lab Stock Pulls Out of a Nosedive Friday: What's Going On?",
  summary: "Rocket Lab shares are trading higher Friday ahead of Monday's earnings report.",
  source: "Benzinga",
  url: "https://finnhub.io/api/news?id=43a8fd13",
  publishedAt: "2026-11-06T08:50:38Z", // 3:50 AM ET
};

function article(i: number): NewsArticle {
  return {
    headline: `Space stocks story ${i}`,
    summary: "",
    source: "Yahoo",
    url: `https://finnhub.io/api/news?id=${i}`,
    publishedAt: `2026-11-0${(i % 6) + 1}T15:00:00Z`,
  };
}

const news = (articles: NewsArticle[]) =>
  ok({ symbol: "RKLB", articles, freshness: freshness({ provider: "finnhub" }) });

describe("CompanyNews", () => {
  it("lists headlines that open the article in a new tab", async () => {
    mockApi({ "/api/v1/stocks/RKLB/news": () => news([BENZINGA, article(1)]) });
    renderWithProviders(<CompanyNews symbol="RKLB" />);

    const link = await screen.findByRole("link", { name: /Rocket Lab Stock Pulls Out/ });
    expect(link).toHaveAttribute("href", BENZINGA.url);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAccessibleName(/\(เปิดในแท็บใหม่\)$/);
    expect(within(link).getByText("Benzinga")).toBeInTheDocument();
    const time = within(link).getByText(/3:50 AM ET$/);
    expect(time.tagName).toBe("TIME");
    expect(time).toHaveAttribute("datetime", BENZINGA.publishedAt);
    // Headlines are English as the vendor sent them; the summary is not shown.
    expect(within(link).getByText(BENZINGA.headline)).toHaveAttribute("lang", "en");
    expect(screen.queryByText(BENZINGA.summary)).toBeNull();

    const card = screen.getByRole("region", { name: "ข่าวล่าสุด" });
    expect(within(card).getByRole("heading", { name: "ข่าวล่าสุด" })).toBeInTheDocument();
    expect(within(card).getByText("7 วันล่าสุด")).toBeInTheDocument();
    expect(within(card).getAllByRole("link")).toHaveLength(2);
    expect(
      within(card).getByText(/หัวข้อข่าวเป็นภาษาอังกฤษตามต้นฉบับจากผู้ให้บริการ/),
    ).toHaveTextContent(/ข้อมูลจาก Finnhub · อัปเดต/);
    expect(screen.queryByRole("button", { name: /ดูข่าวเพิ่ม/ })).toBeNull();
  });

  it("shows five headlines first and the rest on request", async () => {
    const articles = Array.from({ length: 8 }, (_, i) => article(i));
    mockApi({ "/api/v1/stocks/RKLB/news": () => news(articles) });
    renderWithProviders(<CompanyNews symbol="RKLB" />);

    await screen.findByText("Space stocks story 0");
    expect(screen.getAllByRole("link")).toHaveLength(5);
    const more = screen.getByRole("button", { name: "ดูข่าวเพิ่มอีก 3 ข่าว" });
    expect(more).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(more);
    expect(screen.getAllByRole("link")).toHaveLength(8);
    expect(screen.getByRole("button", { name: "แสดงน้อยลง" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("says when there is no news this week", async () => {
    mockApi({ "/api/v1/stocks/RKLB/news": () => news([]) });
    renderWithProviders(<CompanyNews symbol="RKLB" />);

    expect(await screen.findByText("ยังไม่มีข่าวในสัปดาห์นี้")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(/ข้อมูลจาก Finnhub/)).toBeInTheDocument();
  });

  it("hides without a news vendor and shows other errors", async () => {
    const fetchMock = mockApi({
      "/api/v1/stocks/RKLB/news": () => apiError(503, "provider_not_configured"),
    });
    const first = renderWithProviders(<CompanyNews symbol="RKLB" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(first.container).toBeEmptyDOMElement());
    first.unmount();

    mockApi({
      "/api/v1/stocks/RKLB/news": () => apiError(429, "rate_limited", "x", { "Retry-After": "60" }),
    });
    renderWithProviders(<CompanyNews symbol="RKLB" />);
    expect(await screen.findByText("ขอพักหายใจแป๊บนึง")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ลองใหม่/ })).toBeInTheDocument();
  });

  it("asks for the news only once the card is near the screen", async () => {
    let reveal: () => void = () => {};
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(cb: IntersectionObserverCallback) {
          reveal = () => cb([{ isIntersecting: true } as IntersectionObserverEntry], this as never);
        }
        observe() {}
        disconnect() {}
      },
    );
    const fetchMock = mockApi({ "/api/v1/stocks/RKLB/news": () => news([BENZINGA]) });
    renderWithProviders(<CompanyNews symbol="RKLB" />);

    expect(screen.getByLabelText("กำลังโหลดข่าวล่าสุด")).toHaveAttribute("aria-busy", "true");
    expect(fetchMock).not.toHaveBeenCalled();
    act(() => reveal());
    expect(await screen.findByRole("link", { name: /Rocket Lab/ })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("MoreScreen data sources", () => {
  it("names the news vendor", async () => {
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
              news: { name: "finnhub", configured: true },
            },
          },
        }),
    });
    renderWithProviders(<MoreScreen />);
    expect((await screen.findByText("ข่าวบริษัท")).nextSibling).toHaveTextContent("Finnhub");
  });
});
