import { MAX_WATCHLIST_SYMBOLS } from "@/lib/config";
import { normalizeSymbol } from "@/lib/symbols";

/** Keeps valid, unique symbols in order, capped at the watchlist limit. */
export function sanitizeSymbols(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const item of input) {
    if (typeof item !== "string") continue;
    const s = normalizeSymbol(item);
    if (s && !out.includes(s)) out.push(s);
    if (out.length === MAX_WATCHLIST_SYMBOLS) break;
  }
  return out;
}

export class WatchlistFullError extends Error {
  constructor() {
    super(`เก็บหุ้นที่สนใจได้สูงสุด ${MAX_WATCHLIST_SYMBOLS} ตัว`);
    this.name = "WatchlistFullError";
  }
}

export function addSymbol(list: string[], raw: string): string[] {
  const s = normalizeSymbol(raw);
  if (!s || list.includes(s)) return list;
  if (list.length >= MAX_WATCHLIST_SYMBOLS) throw new WatchlistFullError();
  return [...list, s];
}

export function removeSymbol(list: string[], raw: string): string[] {
  const s = normalizeSymbol(raw);
  return s ? list.filter((x) => x !== s) : list;
}

export function toggleSymbol(list: string[], raw: string): string[] {
  const s = normalizeSymbol(raw);
  if (!s) return list;
  return list.includes(s) ? removeSymbol(list, s) : addSymbol(list, s);
}
