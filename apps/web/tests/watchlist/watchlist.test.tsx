import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WatchlistProvider } from "@/features/watchlist/use-watchlist";
import { MemoryWatchlistRepository } from "@/features/watchlist/watchlist-repository";
import { WatchlistScreen } from "@/features/watchlist/watchlist-screen";
import { WatchlistToggle } from "@/features/watchlist/watchlist-toggle";

import { apiError, ok, quote } from "../fixtures";
import { renderWithProviders } from "../render";

afterEach(() => vi.unstubAllGlobals());

function mockQuotes(handler: (symbols: string[]) => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/api/v1/stocks/quotes")
        return handler((url.searchParams.get("symbols") ?? "").split(","));
      return apiError(429, "rate_limited"); // sparklines: unavailable, so they must not render
    }),
  );
}

describe("WatchlistToggle", () => {
  it("adds and removes a symbol and persists it", async () => {
    const repository = new MemoryWatchlistRepository();
    renderWithProviders(<WatchlistToggle symbol="AAPL" />, { repository });

    const button = await screen.findByRole("button", { name: "เพิ่ม AAPL ในหุ้นที่สนใจ" });
    await waitFor(() => expect(button).toBeEnabled());
    expect(button).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(button);
    expect(screen.getByRole("button", { name: "นำ AAPL ออกจากหุ้นที่สนใจ" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await waitFor(async () => expect(await repository.list()).toEqual(["AAPL"]));

    await userEvent.click(screen.getByRole("button", { name: "นำ AAPL ออกจากหุ้นที่สนใจ" }));
    await waitFor(async () => expect(await repository.list()).toEqual([]));
  });
});

describe("WatchlistScreen", () => {
  it("shows an empty state with a way to discover stocks", async () => {
    mockQuotes(() => ok({ quotes: [], unavailable: [] }));
    renderWithProviders(<WatchlistScreen />);
    expect(await screen.findByText("ยังไม่มีหุ้นที่สนใจ")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "สำรวจหุ้น" })).toHaveAttribute("href", "/#search");
    expect(screen.getByText(/อุปกรณ์นี้เท่านั้น|หน่วยความจำ/)).toBeInTheDocument();
  });

  it("keeps the storage description out of server HTML so hydration matches", () => {
    const html = renderToString(
      <QueryClientProvider client={new QueryClient()}>
        <WatchlistProvider repository={new MemoryWatchlistRepository()}>
          <WatchlistScreen />
        </WatchlistProvider>
      </QueryClientProvider>,
    );
    expect(html).toContain("หุ้นที่สนใจ");
    expect(html).not.toContain("หน่วยความจำ");
  });

  it("lists quotes, reports unavailable symbols, and removes in edit mode", async () => {
    mockQuotes(() =>
      ok({
        quotes: [quote({ symbol: "AAPL" })],
        unavailable: [{ symbol: "ZZZZ", reason: "not_found" }],
      }),
    );
    const repository = new MemoryWatchlistRepository(["AAPL", "ZZZZ"]);
    renderWithProviders(<WatchlistScreen />, { repository });

    const row = (await screen.findByText("Apple Inc.")).closest("li")!;
    expect(within(row).getByText("$189.32")).toBeInTheDocument();
    expect(within(row).getByText("+0.99%")).toBeInTheDocument();
    const missing = screen.getByRole("link", { name: /^ZZZZ/ }).closest("li")!;
    expect(within(missing).getByText("ไม่มีข้อมูลราคา")).toBeInTheDocument();
    expect(within(missing).getByText("ไม่พบหุ้นนี้")).toBeInTheDocument();
    expect(within(missing).queryByText(/\$/)).toBeNull();
    expect(row.querySelector("polyline")).toBeNull(); // no fabricated sparkline without candles

    await userEvent.click(screen.getByRole("button", { name: "แก้ไขรายการ" }));
    await userEvent.click(screen.getByRole("button", { name: "ลบ ZZZZ" }));
    await waitFor(async () => expect(await repository.list()).toEqual(["AAPL"]));
  });

  it("shows the API error when no quotes can be loaded", async () => {
    mockQuotes(() => apiError(503, "provider_not_configured"));
    renderWithProviders(<WatchlistScreen />, {
      repository: new MemoryWatchlistRepository(["AAPL"]),
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "ยังไม่ได้ตั้งค่าผู้ให้บริการข้อมูล",
    );
    expect(screen.getByText(/ไม่มีข้อมูลราคา/)).toBeInTheDocument();
  });
});
