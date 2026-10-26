const LABELS: Record<string, string> = {
  twelvedata: "Twelve Data",
  finnhub: "Finnhub",
};

/** Display name of a market-data vendor id from the API ("twelvedata" → "Twelve Data"). */
export function vendorLabel(id: string): string {
  return LABELS[id] ?? id;
}
