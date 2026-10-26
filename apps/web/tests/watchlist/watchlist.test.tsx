import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

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

    const button = await screen.findByRole("button", { name: "Add AAPL to watchlist" });
    await waitFor(() => expect(button).toBeEnabled());
    expect(button).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(button);
    expect(screen.getByRole("button", { name: "Remove AAPL from watchlist" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await waitFor(async () => expect(await repository.list()).toEqual(["AAPL"]));

    await userEvent.click(screen.getByRole("button", { name: "Remove AAPL from watchlist" }));
    await waitFor(async () => expect(await repository.list()).toEqual([]));
  });
});

describe("WatchlistScreen", () => {
  it("shows an empty state with a way to discover stocks", async () => {
    mockQuotes(() => ok({ quotes: [], unavailable: [] }));
    renderWithProviders(<WatchlistScreen />);
    expect(await screen.findByText("Your watchlist is empty")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Discover stocks" })).toHaveAttribute(
      "href",
      "/#search",
    );
    expect(screen.getByText(/this device only|memory/i)).toBeInTheDocument();
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
    expect(within(missing).getByText("Price unavailable")).toBeInTheDocument();
    expect(within(missing).getByText("Symbol not found")).toBeInTheDocument();
    expect(within(missing).queryByText(/\$/)).toBeNull();
    expect(row.querySelector("polyline")).toBeNull(); // no fabricated sparkline without candles

    await userEvent.click(screen.getByRole("button", { name: "Edit watchlist" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove ZZZZ" }));
    await waitFor(async () => expect(await repository.list()).toEqual(["AAPL"]));
  });

  it("shows the API error when no quotes can be loaded", async () => {
    mockQuotes(() => apiError(503, "provider_not_configured"));
    renderWithProviders(<WatchlistScreen />, {
      repository: new MemoryWatchlistRepository(["AAPL"]),
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("Data provider not configured");
    expect(screen.getByText(/Price unavailable/)).toBeInTheDocument();
  });
});
