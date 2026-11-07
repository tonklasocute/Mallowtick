const LABELS: Record<string, string> = {
  twelvedata: "Twelve Data",
  finnhub: "Finnhub",
};

/**
 * Display name of a market-data vendor id from the API ("twelvedata" → "Twelve Data").
 * Data from two vendors comes as "twelvedata+finnhub" (e.g. a chart whose latest bar is
 * another vendor's quote) and reads "Twelve Data + Finnhub". Unknown ids stay as they are.
 */
export function vendorLabel(id: string): string {
  return id
    .split("+")
    .map((part) => LABELS[part] ?? part)
    .join(" + ");
}
