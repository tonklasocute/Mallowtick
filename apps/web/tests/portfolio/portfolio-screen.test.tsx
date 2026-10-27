import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Holding, Portfolio } from "@/features/portfolio/portfolio-model";
import { PortfolioScreen } from "@/features/portfolio/portfolio-screen";
import { MemoryWatchlistRepository } from "@/features/watchlist/watchlist-repository";
import type { Quote } from "@/types/api";

import { apiError, freshness, ok, quote } from "../fixtures";
import { renderWithProviders } from "../render";

afterEach(() => vi.unstubAllGlobals());

const QUOTES: Record<string, Quote> = {
  AAPL: quote({
    symbol: "AAPL",
    name: "Apple Inc",
    price: 343.91,
    change: -2.94,
    freshness: freshness({ provider: "finnhub" }),
  }),
  TSLA: quote({
    symbol: "TSLA",
    name: "Tesla Inc",
    price: 425.1,
    change: -7.9,
    freshness: freshness({ provider: "finnhub" }),
  }),
};

function mockApi({ fx = true }: { fx?: boolean } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/api/v1/fx/usd-thb") {
        return fx
          ? ok({
              pair: "USD/THB",
              rate: 33.12,
              asOf: "2026-10-23T18:59:00Z",
              freshness: freshness(),
            })
          : apiError(503, "provider_unavailable");
      }
      if (url.pathname === "/api/v1/stocks/quotes") {
        const syms = url.searchParams.get("symbols")!.split(",");
        return ok({ quotes: syms.flatMap((s) => (QUOTES[s] ? [QUOTES[s]] : [])), unavailable: [] });
      }
      const one = url.pathname.match(/^\/api\/v1\/stocks\/([A-Z]+)\/quote$/);
      if (one && QUOTES[one[1]!]) return ok(QUOTES[one[1]!]);
      return apiError(404, "not_found");
    }),
  );
}

const holding = (h: Partial<Holding> & { symbol: string }): Holding => ({
  shares: 1,
  avgCost: 100,
  buyRate: null,
  targetPrice: null,
  stopLoss: null,
  targetWeight: null,
  ...h,
});

const PORTFOLIO: Portfolio = {
  currency: "THB",
  goal: null,
  holdings: [
    holding({ symbol: "AAPL", shares: 10, avgCost: 250, buyRate: 35.2 }),
    holding({ symbol: "TSLA", shares: 5, avgCost: 520 }),
  ],
};

describe("PortfolioScreen", () => {
  it("adds a first holding from the watchlist and values it in baht", async () => {
    mockApi();
    const { portfolio } = renderWithProviders(<PortfolioScreen />, {
      repository: new MemoryWatchlistRepository(["AAPL"]),
    });
    const user = userEvent.setup();

    expect(await screen.findByText("ยังไม่มีหุ้นในพอร์ต")).toBeInTheDocument();
    expect(await screen.findByText(/มีอยู่ 1 ตัว/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /เพิ่มหุ้นตัวแรก/ }));

    const sheet = await screen.findByRole("dialog", { name: "เพิ่มหุ้นในพอร์ต" });
    await user.click(within(sheet).getByRole("button", { name: "AAPL" }));
    await within(sheet).findByText(/ราคาตอนนี้ \$343\.91/);

    // Saving without the required fields only shows what is missing.
    await user.click(within(sheet).getByRole("button", { name: "บันทึก" }));
    expect(within(sheet).getAllByText("ต้องใส่")).toHaveLength(2);

    await user.type(within(sheet).getByLabelText("จำนวนหุ้น"), "10");
    // Either cost field fills in the other.
    await user.type(within(sheet).getByLabelText("ราคาเฉลี่ยต่อหุ้น (USD)"), "260");
    expect(within(sheet).getByLabelText("ต้นทุนรวม (USD)")).toHaveValue("2600");
    const total = within(sheet).getByLabelText("ต้นทุนรวม (USD)");
    await user.clear(total);
    await user.type(total, "2,500");
    expect(within(sheet).getByLabelText("ราคาเฉลี่ยต่อหุ้น (USD)")).toHaveValue("250");
    expect(within(sheet).queryByLabelText(/เรทตอนซื้อ/)).toBeNull();
    expect(within(sheet).queryByLabelText(/ราคาเป้าหมาย/)).toBeNull();

    // Without a purchase rate the baht cost uses today's rate: 2,500 × 33.12.
    const result = within(sheet).getByRole("region", { name: "ผลลัพธ์" });
    expect(within(result).getByText("฿113,903", { exact: false })).toBeInTheDocument();
    expect(within(result).getByText("฿82,800", { exact: false })).toBeInTheDocument();
    expect(within(result).getByText(/\+฿31,103/)).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "บันทึก" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(
      await screen.findByRole("button", { name: /AAPL.*10 หุ้น.*฿113,903/ }),
    ).toBeInTheDocument();
    expect((await portfolio.load()).holdings).toEqual([
      holding({ symbol: "AAPL", shares: 10, avgCost: 250 }),
    ]);
  });

  it("keeps fields the sheet doesn't show when editing", async () => {
    mockApi();
    const { portfolio } = renderWithProviders(<PortfolioScreen />, { portfolio: PORTFOLIO });
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /^AAPL/ }));
    const sheet = await screen.findByRole("dialog", { name: "แก้หุ้นในพอร์ต" });
    expect(within(sheet).getByLabelText("ต้นทุนรวม (USD)")).toHaveValue("2500");
    const shares = within(sheet).getByLabelText("จำนวนหุ้น");
    await user.clear(shares);
    await user.type(shares, "12");
    expect(within(sheet).getByLabelText("ต้นทุนรวม (USD)")).toHaveValue("3000");
    await user.click(within(sheet).getByRole("button", { name: "บันทึก" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const aapl = (await portfolio.load()).holdings[0];
    expect(aapl).toEqual(holding({ symbol: "AAPL", shares: 12, avgCost: 250, buyRate: 35.2 }));
  });

  it("sums the holdings, switches currency and filters to losses", async () => {
    mockApi();
    renderWithProviders(<PortfolioScreen />, { portfolio: PORTFOLIO });
    const user = userEvent.setup();

    const summary = await screen.findByRole("region", { name: "สรุปพอร์ต" });
    // 3,439.10 × 33.12 + 2,125.50 × 33.12 = 184,299.55
    expect(within(summary).getByText("฿184,300")).toBeInTheDocument();
    expect(within(summary).getByText(/จากค่าเงินบาท -฿5,200/)).toBeInTheDocument();
    expect(screen.getByText(/1 USD = 33\.12 บาท/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /สลับสกุลเงิน/ }));
    expect(await within(summary).findByText("$5,564.60")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "ติดลบ 1" }));
    const list = screen.getByRole("region", { name: "หุ้นในพอร์ต" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual([expect.stringContaining("TSLA")]);
  });

  it("folds the allocation until asked", async () => {
    mockApi();
    renderWithProviders(<PortfolioScreen />, { portfolio: PORTFOLIO });
    const user = userEvent.setup();

    const toggle = await screen.findByRole("button", { name: /สัดส่วนพอร์ต/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent("ใหญ่สุด AAPL 61.8%");
    expect(screen.queryByRole("img", { name: /แผนภูมิวงกลม/ })).toBeNull();
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("img", { name: /แผนภูมิวงกลม/ })).toBeInTheDocument();
    expect(screen.getByText("38.2%")).toBeInTheDocument();
  });

  it("shows dollars when the baht rate is unavailable", async () => {
    mockApi({ fx: false });
    renderWithProviders(<PortfolioScreen />, { portfolio: PORTFOLIO });
    expect(await screen.findByText(/ยังไม่มีเรทเงินบาท/)).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "สรุปพอร์ต" })).getByText("$5,564.60"),
    ).toBeInTheDocument();
  });

  it("sets a value goal from a preset", async () => {
    mockApi();
    const { portfolio } = renderWithProviders(<PortfolioScreen />, { portfolio: PORTFOLIO });
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "ตั้งเป้าหมายพอร์ต" }));
    const sheet = await screen.findByRole("dialog", { name: "ตั้งเป้าหมาย" });
    expect(within(sheet).queryByText(/แบ่งเงินในพอร์ต/)).toBeNull();
    await user.click(within(sheet).getByRole("button", { name: "฿1M" }));
    expect(within(sheet).getByText("฿1,000,000")).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "บันทึกเป้าหมาย" }));

    const summary = await screen.findByRole("region", { name: "สรุปพอร์ต" });
    expect(await within(summary).findByText("เป้าหมาย ฿1,000,000")).toBeInTheDocument();
    expect((await portfolio.load()).goal).toEqual({ amount: 1_000_000, currency: "THB" });
  });
});
