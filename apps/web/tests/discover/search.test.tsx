import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DiscoverScreen } from "@/features/discover/discover-screen";

import { apiError, ok } from "../fixtures";
import { renderWithProviders } from "../render";

const emptyOverview = { benchmarks: [], popular: [], unavailable: [] };

/** Routes fetch calls by path; search responses come from `search`. */
function mockApi(search: (q: string) => Response) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/v1/stocks/search") return search(url.searchParams.get("q") ?? "");
    if (url.pathname === "/api/v1/market/overview") return ok(emptyOverview);
    if (url.pathname === "/api/v1/market/status") return apiError(503, "provider_not_configured");
    return apiError(404, "not_found");
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("Discover search", () => {
  it("debounces input and shows matching US stocks", async () => {
    const fetchMock = mockApi(() =>
      ok({
        query: "apple",
        results: [{ symbol: "AAPL", name: "Apple Inc.", exchange: "NASDAQ", type: "Common Stock" }],
      }),
    );
    renderWithProviders(<DiscoverScreen />);

    await userEvent.type(screen.getByRole("searchbox", { name: /ค้นหาหุ้นสหรัฐฯ/ }), "apple");

    expect(await screen.findByRole("link", { name: /AAPL.*Apple Inc\./ })).toHaveAttribute(
      "href",
      "/stocks/AAPL",
    );
    const searchCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes("/stocks/search"));
    expect(searchCalls).toHaveLength(1); // one request after typing stops, not one per keystroke
    expect(screen.getByRole("status", { name: "" })).toHaveTextContent("พบ 1 รายการ");
  });

  it("shows an empty state when nothing matches", async () => {
    mockApi(() => ok({ query: "zzzz", results: [] }));
    renderWithProviders(<DiscoverScreen />);
    await userEvent.type(screen.getByRole("searchbox"), "zzzz");
    expect(await screen.findByText(/ไม่พบหุ้นสหรัฐฯ ที่ตรงกับ/)).toBeInTheDocument();
  });

  it("shows an error with retry, then recovers", async () => {
    let fail = true;
    mockApi(() =>
      fail
        ? apiError(502, "provider_unavailable")
        : ok({
            query: "msft",
            results: [{ symbol: "MSFT", name: "Microsoft", exchange: "NASDAQ" }],
          }),
    );
    renderWithProviders(<DiscoverScreen />);
    await userEvent.type(screen.getByRole("searchbox"), "msft");

    expect(await screen.findByRole("alert")).toHaveTextContent("โหลดข้อมูลตลาดไม่ได้");
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: /ลองใหม่/ }));
    expect(await screen.findByRole("link", { name: /MSFT/ })).toBeInTheDocument();
  });

  it("explains a missing provider configuration instead of showing data", async () => {
    mockApi(() => apiError(503, "provider_not_configured"));
    renderWithProviders(<DiscoverScreen />);
    await userEvent.type(screen.getByRole("searchbox"), "a");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "ยังไม่ได้ตั้งค่าผู้ให้บริการข้อมูล",
    );
    expect(screen.queryByRole("button", { name: /ลองใหม่/ })).not.toBeInTheDocument();
  });

  it("clears the query and returns to the overview", async () => {
    mockApi(() => ok({ query: "a", results: [] }));
    renderWithProviders(<DiscoverScreen />);
    const box = screen.getByRole("searchbox");
    await userEvent.type(box, "a");
    await userEvent.click(screen.getByRole("button", { name: /ล้างคำค้นหา/ }));
    expect(box).toHaveValue("");
    await waitFor(() => expect(screen.getByText(/เริ่มต้นด้วยการค้นหาหุ้น/)).toBeInTheDocument());
  });
});
