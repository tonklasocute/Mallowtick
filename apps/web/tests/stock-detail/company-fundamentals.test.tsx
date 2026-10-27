import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CompanyFundamentals } from "@/features/stock-detail/company-fundamentals";
import type { KeyMetrics } from "@/types/api";

import { apiError, freshness, ok } from "../fixtures";
import { renderWithProviders } from "../render";

afterEach(() => vi.unstubAllGlobals());

function mockFundamentals(response: () => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname;
      return path === "/api/v1/stocks/RKLB/fundamentals" ? response() : apiError(404, "not_found");
    }),
  );
}

const NO_METRICS: KeyMetrics = {
  marketCap: null,
  enterpriseValue: null,
  peTTM: null,
  psTTM: null,
  pb: null,
  epsTTM: null,
  revenueGrowthYoY: null,
  revenueGrowth5Y: null,
  epsGrowthYoY: null,
  grossMarginTTM: null,
  operatingMarginTTM: null,
  netMarginTTM: null,
  roeTTM: null,
  currentRatio: null,
  debtToEquity: null,
  dividendYield: null,
  payoutRatioTTM: null,
  beta: null,
  priceReturnYTD: null,
  priceReturn1Y: null,
  sp500ReturnYTD: null,
  sp500Return1Y: null,
  fiftyTwoWeekHigh: null,
  fiftyTwoWeekLow: null,
  fiftyTwoWeekHighDate: "",
  fiftyTwoWeekLowDate: "",
};

// Values reported by Finnhub for RKLB on 2026-10-27.
const RKLB = {
  symbol: "RKLB",
  industry: "Aerospace & Defense",
  country: "US",
  ipoDate: "2020-11-16",
  website: "https://rocketlabcorp.com/",
  sharesOutstanding: 598_460_000,
  metrics: {
    ...NO_METRICS,
    marketCap: 32_209_104_000,
    psTTM: 41.8764,
    epsTTM: -0.2795,
    revenueGrowthYoY: 52.53,
    netMarginTTM: -21.51,
    beta: 3.2,
    priceReturn1Y: -17.2566,
    sp500Return1Y: 13.1312,
    fiftyTwoWeekHigh: 150.9999,
    fiftyTwoWeekHighDate: "2026-05-27",
  },
  freshness: freshness({ provider: "finnhub" }),
};

describe("CompanyFundamentals", () => {
  it("shows the profile and the reported metrics", async () => {
    mockFundamentals(() => ok(RKLB));
    renderWithProviders(<CompanyFundamentals symbol="RKLB" />);

    expect((await screen.findByText("กลุ่มอุตสาหกรรม")).nextSibling).toHaveTextContent(
      "Aerospace & Defense",
    );
    expect(screen.getByText("เข้าตลาดเมื่อ").nextSibling).toHaveTextContent("16 พ.ย. 2020");
    expect(screen.getByRole("link", { name: "rocketlabcorp.com" })).toHaveAttribute(
      "href",
      "https://rocketlabcorp.com/",
    );
    expect(screen.getByText("มูลค่าตลาด").nextSibling).toHaveTextContent("$32.21B");
    expect(screen.getByText("P/E").nextSibling).toHaveTextContent("ขาดทุน");
    expect(screen.getByText("รายได้ เทียบปีก่อน").nextSibling).toHaveTextContent("+52.53%");
    expect(screen.getByText("รายได้ เทียบปีก่อน").nextSibling).toHaveClass("text-up");
    // Margins are bars from the centre with the value beside them. text-ink would
    // override the custom colour classes, so it must not be applied too.
    expect(screen.getByText("อัตรากำไรสุทธิ").closest("li")).toHaveTextContent(
      "อัตรากำไรสุทธิ-21.51%",
    );
    expect(screen.getByText("-21.51%")).toHaveClass("text-down");
    expect(screen.getByText("-21.51%")).not.toHaveClass("text-ink");
    // Returns are compared with the S&P 500's; the 52-week high carries its date.
    expect(screen.getByText("1 ปี").parentElement).toHaveTextContent(
      "1 ปีRKLB-17.26%S&P 500+13.13%",
    );
    expect(screen.getByText("-17.26%")).toHaveClass("text-down");
    const high = screen.getByText("สูงสุด 52 สัปดาห์").nextSibling;
    expect(high).toHaveTextContent("151.00");
    expect(high?.nextSibling).toHaveTextContent("27 พ.ค. 2026");
    // Metrics the vendor didn't report are left out rather than shown as "—".
    expect(screen.queryByText("ตั้งแต่ต้นปี")).not.toBeInTheDocument();
    expect(screen.queryByText("อัตราปันผล")).not.toBeInTheDocument();
    expect(screen.queryByText("ฐานะการเงิน")).not.toBeInTheDocument();
    expect(screen.getByText(/ข้อมูลจาก Finnhub/)).toBeInTheDocument();
  });

  it("keeps a huge growth figure on one line without decimals", async () => {
    mockFundamentals(() =>
      ok({
        ...RKLB,
        metrics: { ...RKLB.metrics, revenueGrowthYoY: 2256.89, revenueGrowth5Y: 64.04 },
      }),
    );
    renderWithProviders(<CompanyFundamentals symbol="RKLB" />);

    const big = (await screen.findByText("รายได้ เทียบปีก่อน")).nextSibling as HTMLElement;
    expect(big).toHaveTextContent("+2,257%");
    // nowrap keeps the arrow beside the number instead of wrapping after it.
    expect(big).toHaveClass("whitespace-nowrap");
    expect(screen.getByText("รายได้ เฉลี่ยต่อปี 5 ปี").nextSibling).toHaveTextContent("+64.04%");
    expect(screen.getByText("รายได้ เฉลี่ยต่อปี 5 ปี").nextSibling).toHaveClass("text-2xl");
  });

  it("says when the vendor has nothing for the symbol", async () => {
    mockFundamentals(() =>
      ok({
        ...RKLB,
        industry: "",
        ipoDate: "",
        website: "",
        sharesOutstanding: null,
        metrics: NO_METRICS,
      }),
    );
    renderWithProviders(<CompanyFundamentals symbol="RKLB" />);
    expect(await screen.findByText("ไม่มีข้อมูลพื้นฐานของหลักทรัพย์นี้")).toBeInTheDocument();
  });

  it("names the missing Finnhub key when no vendor is configured", async () => {
    mockFundamentals(() => apiError(503, "provider_not_configured"));
    renderWithProviders(<CompanyFundamentals symbol="RKLB" />);
    expect(await screen.findByText("ยังไม่ได้ตั้งค่าแหล่งข้อมูลบริษัท")).toBeInTheDocument();
    expect(screen.getByText(/FINNHUB_API_KEY/)).toBeInTheDocument();
  });
});
