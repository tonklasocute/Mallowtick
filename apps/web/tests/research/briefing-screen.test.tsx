import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BriefingScreen } from "@/features/research/briefing-screen";
import { MemoryWatchlistRepository } from "@/features/watchlist/watchlist-repository";

import { apiError, ok, quote } from "../fixtures";
import { renderWithProviders } from "../render";
import { briefing, insight } from "./fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }));

afterEach(() => vi.unstubAllGlobals());

const holding = (symbol: string, shares: number) => ({
  symbol,
  shares,
  avgCost: 100,
  buyRate: 34.5,
  targetPrice: null,
  stopLoss: null,
  targetWeight: null,
});

function mockApi(b: ReturnType<typeof briefing>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/v1/research/briefing") return ok(b);
    if (url.pathname === "/api/v1/stocks/quotes")
      return ok({
        quotes: [quote({ symbol: "NVDA", price: 300 }), quote({ symbol: "AAPL", price: 100 })],
        unavailable: [],
      });
    return apiError(404, "not_found");
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("BriefingScreen", () => {
  it("groups insights by market, things to watch, holdings and watchlist", async () => {
    const nvda = insight({
      id: "big_move:NVDA",
      type: "big_move",
      symbol: "NVDA",
      title: "NVDA ราคาลง -4.04%",
    });
    const tsla = insight({
      id: "news:TSLA",
      type: "news",
      symbol: "TSLA",
      title: "TSLA มีข่าวใหม่ 3 ข่าวใน 24 ชั่วโมง",
    });
    const fetchMock = mockApi(
      briefing({
        insights: [nvda, tsla],
        thingsToWatch: [nvda],
        coverage: [{ symbol: "TSLA", missing: [{ data: "technicals", reason: "rate_limited" }] }],
      }),
    );
    renderWithProviders(<BriefingScreen />, {
      repository: new MemoryWatchlistRepository(["TSLA", "NVDA"]),
      portfolio: {
        holdings: [holding("NVDA", 3), holding("AAPL", 1)],
        goal: null,
        currency: "THB",
      },
    });

    const market = await screen.findByRole("region", { name: "ภาพรวมตลาด" });
    expect(
      within(market).getByRole("article", { name: "SPY (S&P 500) +0.71%" }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "สิ่งที่ควรจับตา" })).getByText(
        "NVDA ราคาลง -4.04%",
      ),
    ).toBeInTheDocument();
    const mine = screen.getByRole("region", { name: "พอร์ตของฉัน" });
    expect(within(mine).getByText("NVDA ราคาลง -4.04%")).toBeInTheDocument();
    // Concentration is worked out here from the holdings and quotes.
    expect(await within(mine).findByText("NVDA คิดเป็น 90.0% ของพอร์ต")).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "หุ้นที่สนใจ" })).getByText(
        "TSLA มีข่าวใหม่ 3 ข่าวใน 24 ชั่วโมง",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("TSLA: กราฟรายวัน")).toBeInTheDocument();
    expect(screen.getByText(/ไม่ใช่คำแนะนำให้ซื้อหรือขาย/)).toBeInTheDocument();

    // Only tickers leave the device: holdings first, no quantities or costs.
    const briefingCall = fetchMock.mock.calls
      .map(([u]) => new URL(String(u), "http://localhost"))
      .find((u) => u.pathname === "/api/v1/research/briefing")!;
    expect([...briefingCall.searchParams.keys()]).toEqual(["symbols"]);
    expect(briefingCall.searchParams.get("symbols")).toBe("NVDA,AAPL,TSLA");
  });

  it("shows the market alone when the user follows no stocks", async () => {
    mockApi(briefing());
    renderWithProviders(<BriefingScreen />);
    expect(await screen.findByText("ยังไม่มีหุ้นของคุณในสรุป")).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "SPY (S&P 500) +0.71%" })).toBeInTheDocument();
  });

  it("shows each insight's facts, sources and how it was worked out", async () => {
    mockApi(briefing({ insights: [insight()], thingsToWatch: [insight()] }));
    renderWithProviders(<BriefingScreen />, {
      repository: new MemoryWatchlistRepository(["AAPL"]),
    });
    const card = (
      await screen.findAllByRole("article", { name: "AAPL ต่ำกว่าเส้น EMA 50 วัน" })
    )[0]!;
    expect(card).toHaveTextContent("ราคาล่าสุด$189.32");
    expect(card).toHaveTextContent("ห่างจากเส้น-1.92%");
    expect(card).toHaveTextContent("ข้อมูลครบ");
    expect(card).toHaveTextContent(
      "คำนวณจากข้อมูลผู้ให้บริการ · Twelve Data, Finnhub, Mallowtick (คำนวณ)",
    );
    expect(card).toHaveTextContent("วิธีคิด: EMA 50 วันจากราคาปิดรายวัน");
  });

  it("explains an API failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => apiError(503, "provider_not_configured")),
    );
    renderWithProviders(<BriefingScreen />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});
