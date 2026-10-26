import { QuoteRow } from "@/components/stocks/quote-row";
import { UnavailableQuoteRow } from "@/components/stocks/unavailable-quote-row";
import { Card, CardTitle } from "@/components/ui/card";
import type { Quote } from "@/types/api";

import type { UnavailableItem } from "./overview-model";

interface PopularStocksProps {
  quotes: Quote[];
  unavailable: UnavailableItem[];
  receivedAt: number;
}

/** Server-configured popular stocks, with unavailable ones shown in place. */
export function PopularStocks({ quotes, unavailable, receivedAt }: PopularStocksProps) {
  return (
    <Card aria-labelledby="popular-title" className="px-3 pb-2">
      <CardTitle id="popular-title" className="px-1">
        หุ้นยอดนิยม
      </CardTitle>
      <ul className="mt-1 divide-y divide-line">
        {quotes.map((q) => (
          <QuoteRow key={q.symbol} quote={q} receivedAt={receivedAt} />
        ))}
        {unavailable.map((u) => (
          <UnavailableQuoteRow key={u.symbol} symbol={u.symbol} reason={u.label} />
        ))}
      </ul>
    </Card>
  );
}
