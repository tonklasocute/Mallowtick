import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SectorRotation } from "@/features/discover/sector-rotation";
import type { PriceReturns, SectorsResult } from "@/types/api";

import { apiError, freshness, ok } from "../fixtures";
import { renderWithProviders } from "../render";

afterEach(() => vi.unstubAllGlobals());

function mockSectors(response: () => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname;
      return path === "/api/v1/market/sectors" ? response() : apiError(404, "not_found");
    }),
  );
}

const returns = (day: number | null, ytd: number | null): PriceReturns => ({
  "1d": day,
  "1w": null,
  "3m": null,
  ytd,
  "1y": null,
});

const sectors: SectorsResult = {
  benchmark: { symbol: "SPY", returns: returns(0.71, 11.45) },
  sectors: [
    { sector: "energy", symbol: "XLE", returns: returns(-0.4, 55.07) },
    { sector: "technology", symbol: "XLK", returns: returns(1.2, 27.27) },
  ],
  unavailable: [{ symbol: "XLU", reason: "rate_limited" }],
  freshness: freshness({ provider: "finnhub" }),
};

const rowNames = (region: HTMLElement) =>
  within(region)
    .getAllByRole("link")
    .map((a) => a.getAttribute("href"));

describe("SectorRotation", () => {
  it("ranks the sectors against the S&P 500 and links to each ETF", async () => {
    mockSectors(() => ok(sectors));
    renderWithProviders(<SectorRotation />);

    const region = await screen.findByRole("region", { name: "กลุ่มอุตสาหกรรมเทียบตลาด" });
    await within(region).findByText("กลุ่มที่นำตลาด · วันนี้", { exact: false });
    expect(rowNames(region)).toEqual(["/stocks/XLK", "/stocks/XLE"]);
    // The leader card: 1.2 - 0.71 above the index, the index, and the weakest sector.
    expect(within(region).getByText("ชนะตลาด +0.49%")).toBeInTheDocument();
    expect(within(region).getByText("S&P 500 +0.71%")).toBeInTheDocument();
    expect(within(region).getByText("อ่อนสุด: พลังงาน -0.40%")).toBeInTheDocument();
    // Tiles: the leader 2×2 with the gap to the index, the runner-up 2 wide.
    const xlk = within(region).getByRole("link", {
      name: /^เทคโนโลยี XLK \+1\.20%, แรงกว่า S&P 500/,
    });
    expect(xlk.parentElement).toHaveClass("col-span-2", "row-span-2");
    expect(within(xlk).getByText("vs ตลาด +0.49")).toBeInTheDocument();
    const xle = within(region).getByRole("link", {
      name: /^พลังงาน XLE -0\.40%, อ่อนกว่า S&P 500/,
    });
    expect(xle.parentElement).toHaveClass("col-span-2");
    expect(xle).toHaveClass("bg-heat-1"); // -1.11 points
    expect(within(region).getByText(/สาธารณูปโภค \(รอโควตา กำลังโหลดใหม่\)/)).toBeInTheDocument();
    expect(within(region).queryByText(/เกินโควตาการเรียกข้อมูล/)).toBeNull();
    expect(within(region).getByText(/ไม่ใช่ข้อมูลเงินไหลเข้า-ออก/)).toBeInTheDocument();
    expect(within(region).getByText(/ข้อมูลจาก Finnhub/)).toBeInTheDocument();
  });

  it("re-ranks when another period is picked", async () => {
    mockSectors(() => ok(sectors));
    renderWithProviders(<SectorRotation />);

    const region = await screen.findByRole("region", { name: "กลุ่มอุตสาหกรรมเทียบตลาด" });
    await within(region).findByText("กลุ่มที่นำตลาด · วันนี้", { exact: false });
    await userEvent.click(within(region).getByRole("radio", { name: "YTD" }));
    expect(rowNames(region)).toEqual(["/stocks/XLE", "/stocks/XLK"]);
    expect(
      within(region).getByText("กลุ่มที่นำตลาด · ตั้งแต่ต้นปี", { exact: false }),
    ).toBeInTheDocument();
    // 55.07 - 11.45 = 43.62 points above the index: the darkest green.
    expect(within(region).getByRole("link", { name: /^พลังงาน XLE \+55\.07%/ })).toHaveClass(
      "bg-heat-5",
    );
  });

  it("asks for a Finnhub key when no vendor publishes the returns", async () => {
    mockSectors(() => apiError(503, "provider_not_configured"));
    renderWithProviders(<SectorRotation />);
    expect(await screen.findByText(/FINNHUB_API_KEY/)).toBeInTheDocument();
  });
});
