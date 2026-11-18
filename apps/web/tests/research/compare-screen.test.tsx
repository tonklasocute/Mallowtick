import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CompareScreen } from "@/features/research/compare-screen";
import type { CompareItem } from "@/types/api";

import { ok } from "../fixtures";
import { renderWithProviders } from "../render";

vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }));

afterEach(() => vi.unstubAllGlobals());

function item(symbol: string, overrides: Partial<CompareItem> = {}): CompareItem {
  return {
    symbol,
    name: `${symbol} Inc`,
    logo: "",
    currency: "USD",
    price: 100,
    changePercent: -1.5,
    asOf: "2026-10-23T18:59:00Z",
    fundamentals: null,
    epsRecord: { compared: 4, beats: 3, misses: 1, inline: 0 },
    lastQuarter: null,
    ratings: { period: "2026-10-01", strongBuy: 7, buy: 16, hold: 5, sell: 0, strongSell: 1 },
    sources: ["finnhub"],
    missing: [],
    ...overrides,
  };
}

describe("CompareScreen", () => {
  it("compares the chosen stocks and marks missing figures instead of guessing", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      const syms = url.searchParams.get("symbols")!.split(",");
      return ok({
        generatedAt: "2026-10-23T19:00:00Z",
        disclaimer: "ไม่ใช่คำแนะนำให้ซื้อหรือขาย",
        items: syms.map((s) =>
          s === "XYZ"
            ? item(s, {
                epsRecord: null,
                ratings: null,
                missing: [{ data: "fundamentals", reason: "not_found" }],
              })
            : item(s),
        ),
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<CompareScreen initial={["AAPL"]} />);
    expect(screen.getByText("เลือกหุ้นอย่างน้อย 2 ตัวเพื่อเปรียบเทียบ")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("สัญลักษณ์หุ้นที่จะเพิ่ม"), "xyz");
    await user.click(screen.getByRole("button", { name: "เพิ่มหุ้น" }));

    const table = await screen.findByRole("table");
    const eps = within(table).getByRole("row", { name: /EPS ดีกว่าคาด/ });
    expect(eps).toHaveTextContent("EPS ดีกว่าคาด3 จาก 4 ไตรมาส—");
    expect(within(table).getByRole("row", { name: /นักวิเคราะห์/ })).toHaveTextContent(
      "23 / 5 / 1—",
    );
    expect(screen.getByRole("status")).toHaveTextContent("XYZ (ข้อมูลบริษัท)");
    expect(
      new URL(String(fetchMock.mock.calls[0]![0]), "http://localhost").searchParams.get("symbols"),
    ).toBe("AAPL,XYZ");
  });

  it("allows at most four stocks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ok({ generatedAt: "", disclaimer: "", items: [] })),
    );
    renderWithProviders(<CompareScreen initial={["A", "B", "C", "D"]} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("สัญลักษณ์หุ้นที่จะเพิ่ม"), "E");
    await user.click(screen.getByRole("button", { name: "เพิ่มหุ้น" }));
    expect(screen.getByRole("alert")).toHaveTextContent("เปรียบเทียบได้สูงสุด 4 ตัว");
  });
});
