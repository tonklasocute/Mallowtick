import { describe, expect, it } from "vitest";

import { EMPTY_PORTFOLIO } from "@/features/portfolio/portfolio-model";
import {
  LocalStoragePortfolioRepository,
  PORTFOLIO_STORAGE_KEY,
} from "@/features/portfolio/portfolio-repository";
import {
  LocalStorageWatchlistRepository,
  STORAGE_KEY,
} from "@/features/watchlist/watchlist-repository";
import { backupKey, NewerDataError, readVersioned, writeVersioned } from "@/lib/versioned-storage";

const TEST_ENTRY = "mallowtick.test.v1";

describe("readVersioned", () => {
  it("classifies missing, current, newer and unreadable values", () => {
    const s = window.localStorage;
    expect(readVersioned(s, TEST_ENTRY, 1)).toEqual({ status: "empty" });
    s.setItem(TEST_ENTRY, JSON.stringify({ version: 1, a: 1 }));
    expect(readVersioned(s, TEST_ENTRY, 1)).toEqual({ status: "ok", value: { version: 1, a: 1 } });
    s.setItem(TEST_ENTRY, JSON.stringify({ a: 1 }));
    expect(readVersioned(s, TEST_ENTRY, 1).status).toBe("ok");
    s.setItem(TEST_ENTRY, JSON.stringify({ version: 2, a: 1 }));
    expect(readVersioned(s, TEST_ENTRY, 1)).toMatchObject({ status: "newer", version: 2 });
    for (const raw of ["{broken", "[1,2]", "null", "42"]) {
      s.setItem(TEST_ENTRY, raw);
      expect(readVersioned(s, TEST_ENTRY, 1)).toEqual({ status: "corrupt", raw });
    }
  });
});

describe("writeVersioned", () => {
  it("refuses to overwrite a newer version and leaves it untouched", () => {
    const newer = JSON.stringify({ version: 2, symbols: ["AAPL"], extra: true });
    window.localStorage.setItem(TEST_ENTRY, newer);
    expect(() => writeVersioned(window.localStorage, TEST_ENTRY, 1, { version: 1 })).toThrow(
      NewerDataError,
    );
    expect(window.localStorage.getItem(TEST_ENTRY)).toBe(newer);
  });

  it("backs up an unreadable value before writing, and keeps the first backup", () => {
    window.localStorage.setItem(TEST_ENTRY, "{first");
    writeVersioned(window.localStorage, TEST_ENTRY, 1, { version: 1, n: 1 });
    expect(window.localStorage.getItem(backupKey(TEST_ENTRY))).toBe("{first");
    expect(JSON.parse(window.localStorage.getItem(TEST_ENTRY)!)).toEqual({ version: 1, n: 1 });

    window.localStorage.setItem(TEST_ENTRY, "{second");
    writeVersioned(window.localStorage, TEST_ENTRY, 1, { version: 1, n: 2 });
    expect(window.localStorage.getItem(backupKey(TEST_ENTRY))).toBe("{first");
  });
});

describe("watchlist storage guard", () => {
  it("reads v1 data exactly as before", async () => {
    window.localStorage.setItem(STORAGE_KEY, '{"version":1,"symbols":["AAPL","BRK.B"]}');
    expect(await new LocalStorageWatchlistRepository().list()).toEqual(["AAPL", "BRK.B"]);
  });

  it("shows a newer version's list but never saves over it", async () => {
    const newer = JSON.stringify({ version: 2, symbols: ["MSFT"], groups: [{ name: "AI" }] });
    window.localStorage.setItem(STORAGE_KEY, newer);
    const repo = new LocalStorageWatchlistRepository();
    expect(await repo.list()).toEqual(["MSFT"]);
    await expect(repo.save(["MSFT", "NVDA"])).rejects.toBeInstanceOf(NewerDataError);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(newer);
  });

  it("keeps a copy of an unreadable list before it is replaced", async () => {
    window.localStorage.setItem(STORAGE_KEY, "{oops");
    const repo = new LocalStorageWatchlistRepository();
    expect(await repo.list()).toEqual([]);
    expect(window.localStorage.getItem(backupKey(STORAGE_KEY))).toBe("{oops");
    await repo.save(["AAPL"]);
    expect(window.localStorage.getItem(backupKey(STORAGE_KEY))).toBe("{oops");
  });
});

describe("portfolio storage guard", () => {
  const v1 = {
    version: 1,
    currency: "THB",
    goal: { amount: 1_000_000, currency: "THB" },
    holdings: [
      {
        symbol: "AAPL",
        shares: 3.5,
        avgCost: 201.25,
        buyRate: 34.1,
        targetPrice: null,
        stopLoss: null,
        targetWeight: null,
      },
    ],
  };

  it("reads and re-saves v1 data unchanged, cost basis included", async () => {
    window.localStorage.setItem(PORTFOLIO_STORAGE_KEY, JSON.stringify(v1));
    const repo = new LocalStoragePortfolioRepository();
    const loaded = await repo.load();
    expect(loaded.holdings).toEqual(v1.holdings);
    await repo.save(loaded);
    expect(JSON.parse(window.localStorage.getItem(PORTFOLIO_STORAGE_KEY)!)).toEqual(v1);
  });

  it("never saves over a portfolio from a newer version", async () => {
    const newer = JSON.stringify({ ...v1, version: 3, lots: [] });
    window.localStorage.setItem(PORTFOLIO_STORAGE_KEY, newer);
    const repo = new LocalStoragePortfolioRepository();
    expect((await repo.load()).holdings).toHaveLength(1);
    await expect(repo.save(EMPTY_PORTFOLIO)).rejects.toBeInstanceOf(NewerDataError);
    expect(window.localStorage.getItem(PORTFOLIO_STORAGE_KEY)).toBe(newer);
  });

  it("backs up an unreadable portfolio", async () => {
    window.localStorage.setItem(PORTFOLIO_STORAGE_KEY, "not json");
    expect(await new LocalStoragePortfolioRepository().load()).toEqual(EMPTY_PORTFOLIO);
    expect(window.localStorage.getItem(backupKey(PORTFOLIO_STORAGE_KEY))).toBe("not json");
  });
});
