import { Card, CardTitle } from "@/components/ui/card";
import { formatCompact, formatNumber } from "@/lib/format";
import type { Quote } from "@/types/api";

export function QuoteStats({ quote }: { quote: Quote }) {
  const rows: [string, string][] = [
    ["Open", formatNumber(quote.open)],
    ["High", formatNumber(quote.high)],
    ["Low", formatNumber(quote.low)],
    ["Prev. close", formatNumber(quote.previousClose)],
    ["Volume", formatCompact(quote.volume)],
    [
      "52-week range",
      quote.fiftyTwoWeek
        ? `${formatNumber(quote.fiftyTwoWeek.low)} – ${formatNumber(quote.fiftyTwoWeek.high)}`
        : "—",
    ],
  ];
  return (
    <Card>
      <CardTitle className="mb-2">Latest session</CardTitle>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        {rows.map(([k, v]) => (
          <div
            key={k}
            className="flex items-baseline justify-between gap-2 border-b border-line pb-1.5"
          >
            <dt className="text-slate">{k}</dt>
            <dd className="tabular font-semibold text-ink">{v}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
