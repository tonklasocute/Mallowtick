const refreshSeconds = Number(process.env.NEXT_PUBLIC_QUOTE_REFRESH_SECONDS);

/** How often visible screens re-request quotes. Never below 15s. */
export const QUOTE_REFRESH_MS =
  (Number.isFinite(refreshSeconds) && refreshSeconds >= 15 ? refreshSeconds : 60) * 1000;

/** A quote the client has not refreshed for this long is shown as stale. */
export const CLIENT_STALE_AFTER_MS = QUOTE_REFRESH_MS * 3;

/** US equities trade on New York time; timestamps are shown in it. */
export const MARKET_TIMEZONE = "America/New_York";

/** Matches the API's batch limit (MaxBatchSymbols). */
export const MAX_WATCHLIST_SYMBOLS = 25;
