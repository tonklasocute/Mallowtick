import { describe, expect, it, vi } from "vitest";

import {
  LocalStorageWatchlistRepository,
  STORAGE_KEY,
} from "@/features/watchlist/watchlist-repository";

describe("LocalStorageWatchlistRepository", () => {
  it("round-trips symbols in a versioned format", async () => {
    const repo = new LocalStorageWatchlistRepository();
    await repo.save(["AAPL", "nvda"]);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)).toEqual({
      version: 1,
      symbols: ["AAPL", "NVDA"],
    });
    expect(await repo.list()).toEqual(["AAPL", "NVDA"]);
  });

  it("starts empty when storage is missing or corrupted", async () => {
    const repo = new LocalStorageWatchlistRepository();
    expect(await repo.list()).toEqual([]);
    window.localStorage.setItem(STORAGE_KEY, "{not json");
    expect(await repo.list()).toEqual([]);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, symbols: "AAPL" }));
    expect(await repo.list()).toEqual([]);
  });

  it("notifies about changes from other tabs", () => {
    const repo = new LocalStorageWatchlistRepository();
    const onChange = vi.fn();
    const unsubscribe = repo.subscribe(onChange);
    window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
    window.dispatchEvent(new StorageEvent("storage", { key: "something-else" }));
    unsubscribe();
    window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("describes itself as device-local", () => {
    expect(new LocalStorageWatchlistRepository().storageDescription).toMatch(/อุปกรณ์นี้เท่านั้น/);
  });
});
