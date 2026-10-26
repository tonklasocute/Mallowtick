import { describe, expect, it } from "vitest";

import {
  addSymbol,
  removeSymbol,
  sanitizeSymbols,
  toggleSymbol,
  WatchlistFullError,
} from "@/features/watchlist/watchlist-model";
import { MAX_WATCHLIST_SYMBOLS } from "@/lib/config";

describe("watchlist model", () => {
  it("adds normalized symbols once", () => {
    expect(addSymbol([], " aapl ")).toEqual(["AAPL"]);
    expect(addSymbol(["AAPL"], "aapl")).toEqual(["AAPL"]);
    expect(addSymbol(["AAPL"], "brk.b")).toEqual(["AAPL", "BRK.B"]);
  });

  it("ignores invalid symbols", () => {
    expect(addSymbol(["AAPL"], "not a ticker")).toEqual(["AAPL"]);
    expect(removeSymbol(["AAPL"], "<x>")).toEqual(["AAPL"]);
  });

  it("removes and toggles", () => {
    expect(removeSymbol(["AAPL", "MSFT"], "aapl")).toEqual(["MSFT"]);
    expect(toggleSymbol(["AAPL"], "AAPL")).toEqual([]);
    expect(toggleSymbol([], "nvda")).toEqual(["NVDA"]);
  });

  it("enforces the size limit", () => {
    const full = Array.from(
      { length: MAX_WATCHLIST_SYMBOLS },
      (_, i) =>
        `A${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`,
    );
    expect(() => addSymbol(full, "ZZZ")).toThrow(WatchlistFullError);
  });

  it("sanitizes untrusted stored data", () => {
    expect(sanitizeSymbols(["aapl", "AAPL", 42, null, "bad ticker", "msft"])).toEqual([
      "AAPL",
      "MSFT",
    ]);
    expect(sanitizeSymbols("AAPL")).toEqual([]);
    expect(sanitizeSymbols(undefined)).toEqual([]);
  });
});
