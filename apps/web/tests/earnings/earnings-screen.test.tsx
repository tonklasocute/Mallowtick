import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EarningsScreen } from "@/features/earnings/earnings-screen";
import { MemoryWatchlistRepository } from "@/features/watchlist/watchlist-repository";
import type { EarningsEvent } from "@/types/api";

import { apiError, freshness, ok } from "../fixtures";
import { renderWithProviders } from "../render";

vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }));

afterEach(() => vi.unstubAllGlobals());

// 10 PM on 2026-11-17 in New York.
const NOW = new Date("2026-11-18T03:00:00Z");

function ev(symbol: string, date: string, extra: Partial<EarningsEvent> = {}): EarningsEvent {
  return {
    symbol,
    date,
    hour: "amc",
    quarter: 3,
    year: 2027,
    epsEstimate: null,
    revenueEstimate: null,
    epsActual: null,
    revenueActual: null,
    ...extra,
  };
}

function mockCalendar(events: EarningsEvent[], truncated = false) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname !== "/api/v1/earnings/calendar") return apiError(404, "not_found");
    const from = url.searchParams.get("from")!;
    const to = url.searchParams.get("to")!;
    const symbols = url.searchParams.get("symbols")?.split(",");
    return ok({
      from,
      to,
      today: "2026-11-17",
      events: events.filter(
        (e) => e.date >= from && e.date <= to && (!symbols || symbols.includes(e.symbol)),
      ),
      truncated,
      freshness: freshness({ provider: "finnhub", asOf: null }),
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("EarningsScreen", () => {
  it("shows today's reports with actuals against estimates, and where the data comes from", async () => {
    const fetchMock = mockCalendar([
      ev("NVDA", "2026-11-17", {
        name: "NVIDIA Corp",
        epsEstimate: 2.525,
        epsActual: 2.68,
        revenueEstimate: 111_282_164_311,
        revenueActual: 115_844_000_000,
      }),
      ev("XYZ", "2026-11-17", { hour: "", epsEstimate: null }),
    ]);
    renderWithProviders(<EarningsScreen now={NOW} />);

    const nvda = await screen.findByRole("article", { name: "NVDA ประกาศงบ" });
    expect(nvda).toHaveTextContent("NVIDIA Corp · Q3 ปีงบ 2027");
    expect(nvda).toHaveTextContent("ประกาศแล้ว");
    expect(nvda).toHaveTextContent("2.68คาด 2.525▲ +6.14% ดีกว่าคาด");
    expect(nvda).toHaveTextContent("115.84Bคาด 111.28B▲ +4.10% ดีกว่าคาด");
    expect(screen.getByText(/บริษัทต่างประเทศอาจไม่ใช่ USD/)).toBeInTheDocument();
    const xyz = screen.getByRole("article", { name: "XYZ ประกาศงบ" });
    // No estimate and no time: said so, never shown as zero.
    expect(xyz).toHaveTextContent("ยังไม่ระบุเวลา");
    expect(xyz).toHaveTextContent("ไม่มีประมาณการ");
    expect(screen.getByText(/ข้อมูลจาก Finnhub/)).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0]![0])).toContain("from=2026-11-17&to=2026-11-17");
  });

  it("filters to the user's stocks through the API", async () => {
    const fetchMock = mockCalendar([ev("RKLB", "2026-11-20"), ev("NVDA", "2026-11-19")]);
    renderWithProviders(<EarningsScreen now={NOW} />, {
      repository: new MemoryWatchlistRepository(["RKLB"]),
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: "กำลังจะมาถึง" }));
    expect(await screen.findByRole("article", { name: "NVDA ประกาศงบ" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "เฉพาะหุ้นของฉัน (1)" }));
    await waitFor(() =>
      expect(screen.queryByRole("article", { name: "NVDA ประกาศงบ" })).not.toBeInTheDocument(),
    );
    const rklb = screen.getByRole("article", { name: "RKLB ประกาศงบ" });
    expect(within(rklb).getByText("หุ้นของฉัน")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("symbols=RKLB"))).toBe(true);
  });

  it("says a past report has no results in the data instead of calling it upcoming", async () => {
    mockCalendar([ev("PDD", "2026-11-16", { hour: "bmo", epsEstimate: 19.213 })]);
    renderWithProviders(<EarningsScreen now={NOW} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: "ประกาศแล้ว" }));
    const pdd = await screen.findByRole("article", { name: "PDD ประกาศงบ" });
    expect(pdd).toHaveTextContent("ยังไม่มีผลในข้อมูล");
    expect(pdd).not.toHaveTextContent("ก่อนตลาดเปิด");
  });

  it("narrows to one day and searches by ticker", async () => {
    mockCalendar([ev("AAA", "2026-11-19"), ev("BBB", "2026-11-20"), ev("ABC", "2026-11-20")]);
    renderWithProviders(<EarningsScreen now={NOW} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: "กำลังจะมาถึง" }));
    await user.click(await screen.findByRole("button", { name: "20 พ.ย. · 2" }));
    expect(screen.queryByRole("article", { name: "AAA ประกาศงบ" })).not.toBeInTheDocument();
    await user.type(screen.getByRole("searchbox"), "bb");
    expect(screen.getByRole("article", { name: "BBB ประกาศงบ" })).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "ABC ประกาศงบ" })).not.toBeInTheDocument();
  });

  it("warns when the vendor may have left reports out, and handles an empty day", async () => {
    mockCalendar([], true);
    renderWithProviders(<EarningsScreen now={NOW} />);
    expect(await screen.findByText("ไม่มีบริษัทประกาศงบในช่วงนี้")).toBeInTheDocument();
    expect(screen.getByText(/บางบริษัทอาจไม่ปรากฏในรายการ/)).toBeInTheDocument();
  });

  it("explains a missing vendor instead of showing an empty calendar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => apiError(503, "provider_not_configured")),
    );
    renderWithProviders(<EarningsScreen now={NOW} />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
