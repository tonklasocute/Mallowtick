import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MarketOverview } from "@/features/discover/market-overview";
import type { MarketOverview as Overview } from "@/types/api";

import { apiError, ok, quote } from "../fixtures";
import { renderWithProviders } from "../render";

afterEach(() => vi.unstubAllGlobals());

function mockOverview(response: () => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/api/v1/market/overview") return response();
      return apiError(429, "rate_limited"); // sparklines unavailable: none may be drawn
    }),
  );
}

const overview: Overview = {
  benchmarks: [
    quote({ symbol: "SPY", name: "SPDR S&P 500 ETF Trust", price: 759.97 }),
    quote({
      symbol: "QQQ",
      name: "Invesco QQQ Trust",
      price: 704.4,
      change: -0.07,
      changePercent: -0.01,
    }),
  ],
  popular: [quote({ symbol: "AAPL" })],
  unavailable: [
    { symbol: "DIA", reason: "rate_limited", group: "benchmark" },
    { symbol: "TSLA", reason: "not_found", group: "popular" },
  ],
};

describe("MarketOverview", () => {
  it("shows a loading skeleton first", () => {
    mockOverview(() => ok(overview));
    renderWithProviders(<MarketOverview />);
    expect(screen.getByLabelText("กำลังโหลดภาพรวมตลาด")).toHaveAttribute("aria-busy", "true");
  });

  it("renders benchmarks and popular stocks from the API", async () => {
    mockOverview(() => ok(overview));
    renderWithProviders(<MarketOverview />);

    const benchmarks = await screen.findByRole("region", { name: "ดัชนีอ้างอิงตลาด" });
    // The currency symbol is a separate <sup>, so match the whole price element.
    expect(within(benchmarks).getByText((_, el) => el?.textContent === "$759.97")).toHaveClass(
      "tabular",
    );
    expect(within(benchmarks).getByRole("link", { name: /QQQ/ })).toHaveAttribute(
      "href",
      "/stocks/QQQ",
    );
    expect(within(benchmarks).getByText("-0.01%", { exact: false })).toBeInTheDocument();

    const popular = screen.getByRole("region", { name: "หุ้นยอดนิยม" });
    expect(within(popular).getByRole("link", { name: /AAPL.*Apple Inc\./ })).toBeInTheDocument();
    expect(document.querySelector("polyline")).toBeNull();
  });

  it("shows unavailable symbols in place without a price", async () => {
    mockOverview(() => ok(overview));
    renderWithProviders(<MarketOverview />);

    const benchmarks = await screen.findByRole("region", { name: "ดัชนีอ้างอิงตลาด" });
    const dia = within(benchmarks).getByText("DIA").closest("section")!;
    expect(within(dia).getByText("ไม่มีข้อมูล")).toBeInTheDocument();
    expect(within(dia).getByText("เกินโควตาการเรียกข้อมูล")).toBeInTheDocument();
    expect(within(dia).queryByText(/\$/)).toBeNull();

    const tsla = within(screen.getByRole("region", { name: "หุ้นยอดนิยม" }))
      .getByRole("link", { name: /^TSLA/ })
      .closest("li")!;
    expect(within(tsla).getByText("ไม่พบหุ้นนี้")).toBeInTheDocument();
    expect(within(tsla).queryByText(/\$/)).toBeNull();
  });

  it("explains a missing provider instead of showing prices", async () => {
    mockOverview(() => apiError(503, "provider_not_configured"));
    renderWithProviders(<MarketOverview />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "ยังไม่ได้ตั้งค่าผู้ให้บริการข้อมูล",
    );
    expect(screen.queryByText(/\$\d/)).toBeNull();
  });

  it("offers a retry for transient failures", async () => {
    mockOverview(() => apiError(502, "provider_unavailable"));
    renderWithProviders(<MarketOverview />);
    expect(await screen.findByRole("alert")).toHaveTextContent("โหลดข้อมูลตลาดไม่ได้");
    expect(screen.getByRole("button", { name: /ลองใหม่/ })).toBeInTheDocument();
  });

  it("shows an empty state when nothing is configured", async () => {
    mockOverview(() => ok({ benchmarks: [], popular: [], unavailable: [] }));
    renderWithProviders(<MarketOverview />);
    expect(await screen.findByText("เริ่มต้นด้วยการค้นหาหุ้น")).toBeInTheDocument();
  });
});
