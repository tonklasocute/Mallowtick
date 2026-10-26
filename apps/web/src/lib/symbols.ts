// Mirrors the API's ticker validation (market.ParseSymbol).
const SYMBOL_PATTERN = /^[A-Z][A-Z0-9]{0,6}([.-][A-Z0-9]{1,3})?$/;

/** Upper-cases and validates a US ticker such as "brk.b"; returns null if invalid. */
export function normalizeSymbol(raw: string): string | null {
  const s = raw.trim().toUpperCase();
  return SYMBOL_PATTERN.test(s) ? s : null;
}
