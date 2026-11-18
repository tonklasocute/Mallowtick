import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NewsScreen } from "@/features/news/news-screen";
import { CompanyNews } from "@/features/stock-detail/company-news";
import { MemoryWatchlistRepository } from "@/features/watchlist/watchlist-repository";

import { apiError, ok } from "../fixtures";
import { renderWithProviders } from "../render";
import { newsArticle, newsPage } from "./fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }));

afterEach(() => vi.unstubAllGlobals());

type Handler = (url: URL) => Response;

function mockNews(handler: Handler) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
    handler(new URL(String(input), "http://localhost")),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const holding = {
  symbol: "NVDA",
  shares: 1,
  avgCost: 100,
  buyRate: null,
  targetPrice: null,
  stopLoss: null,
  targetWeight: null,
};

describe("NewsScreen", () => {
  it("shows news for the stocks saved on this device, holdings first", async () => {
    const fetchMock = mockNews(() => ok(newsPage([newsArticle()])));
    renderWithProviders(<NewsScreen />, {
      repository: new MemoryWatchlistRepository(["AAPL", "NVDA"]),
      portfolio: { holdings: [holding], goal: null, currency: "THB" },
    });
    expect(await screen.findByRole("article")).toBeInTheDocument();
    expect(screen.getByText(/ข่าวของ NVDA, AAPL/)).toBeInTheDocument();
    const url = new URL(String(fetchMock.mock.calls[0]![0]), "http://localhost");
    expect(url.pathname).toBe("/api/v1/news");
    expect(url.searchParams.get("symbols")).toBe("NVDA,AAPL");
    expect(url.searchParams.has("category")).toBe(false);
    expect(screen.getByText(/ไม่ได้สรุปว่าข่าวใดทำให้ราคาเปลี่ยน/)).toBeInTheDocument();
  });

  it("asks the user to add stocks when none are saved", async () => {
    const fetchMock = mockNews(() => ok(newsPage([])));
    renderWithProviders(<NewsScreen />);
    expect(await screen.findByText("ยังไม่มีหุ้นให้เลือกข่าว")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("switches market categories and pages through results", async () => {
    const fetchMock = mockNews((url) => {
      const page = Number(url.searchParams.get("page") ?? 1);
      return ok(
        newsPage([newsArticle({ id: `fh-${page}`, headline: `Market story page ${page}` })], {
          page,
          total: 2,
          hasMore: page === 1,
        }),
      );
    });
    renderWithProviders(<NewsScreen initialTab="market" />);
    const user = userEvent.setup();
    expect(await screen.findByText("Market story page 1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "โหลดข่าวเพิ่ม (1 ข่าว)" }));
    expect(await screen.findByText("Market story page 2")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "ควบรวมกิจการ" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes("category=merger"))).toBe(true),
    );
  });

  it("opens a company's news from a link, and says which symbols are still to come", async () => {
    mockNews(() => ok(newsPage([], { unavailable: [{ symbol: "TSLA", reason: "rate_limited" }] })));
    renderWithProviders(<NewsScreen initialSymbol="TSLA" />);
    expect(
      await screen.findByText(
        "ยังไม่มีข่าวของ TSLA (เกินโควตาการเรียกข้อมูล) จะโหลดเพิ่มให้อัตโนมัติ",
      ),
    ).toHaveAttribute("role", "status");
    expect(screen.getByText("ยังไม่มีข่าวของ TSLA ใน 7 วันที่ผ่านมา")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "บริษัท" })).toBeChecked();
  });
});

describe("CompanyNews", () => {
  it("shows the latest stories and links to all of them", async () => {
    mockNews(() => ok(newsPage([newsArticle()], { total: 12, limit: 5 })));
    renderWithProviders(<CompanyNews symbol="AAPL" />);
    expect(await screen.findByRole("article")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /ดูข่าวทั้งหมดของ AAPL \(12\)/ })).toHaveAttribute(
      "href",
      "/news?symbol=AAPL",
    );
  });

  it("hides without a news vendor", async () => {
    const fetchMock = mockNews(() => apiError(503, "provider_not_configured"));
    const { container } = renderWithProviders(<CompanyNews symbol="AAPL" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
