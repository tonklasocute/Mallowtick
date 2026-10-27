import { describe, expect, it, vi } from "vitest";

import { EMPTY_PORTFOLIO } from "@/features/portfolio/portfolio-model";
import {
  LocalStoragePortfolioRepository,
  PORTFOLIO_STORAGE_KEY,
} from "@/features/portfolio/portfolio-repository";

describe("LocalStoragePortfolioRepository", () => {
  it("round-trips the portfolio in a versioned format", async () => {
    const repo = new LocalStoragePortfolioRepository();
    const portfolio = {
      currency: "USD" as const,
      goal: { amount: 50_000, currency: "USD" as const },
      holdings: [
        {
          symbol: "aapl",
          shares: 0.5,
          avgCost: 250,
          buyRate: null,
          targetPrice: 380,
          stopLoss: null,
          targetWeight: 25,
        },
      ],
    };
    await repo.save(portfolio);
    const stored = JSON.parse(window.localStorage.getItem(PORTFOLIO_STORAGE_KEY)!);
    expect(stored.version).toBe(1);
    expect(stored.holdings[0].symbol).toBe("AAPL");
    expect(await repo.load()).toEqual({
      ...portfolio,
      holdings: [{ ...portfolio.holdings[0], symbol: "AAPL" }],
    });
  });

  it("starts empty when storage is missing or corrupted", async () => {
    const repo = new LocalStoragePortfolioRepository();
    window.localStorage.removeItem(PORTFOLIO_STORAGE_KEY);
    expect(await repo.load()).toEqual(EMPTY_PORTFOLIO);
    window.localStorage.setItem(PORTFOLIO_STORAGE_KEY, "{not json");
    expect(await repo.load()).toEqual(EMPTY_PORTFOLIO);
  });

  it("notifies about changes from other tabs", () => {
    const repo = new LocalStoragePortfolioRepository();
    const onChange = vi.fn();
    const unsubscribe = repo.subscribe(onChange);
    window.dispatchEvent(new StorageEvent("storage", { key: PORTFOLIO_STORAGE_KEY }));
    window.dispatchEvent(new StorageEvent("storage", { key: "mallowtick.watchlist.v1" }));
    unsubscribe();
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
