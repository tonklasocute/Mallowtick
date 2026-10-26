import { QuoteRow } from "@/components/stocks/quote-row";
import { UnavailableQuoteRow } from "@/components/stocks/unavailable-quote-row";
import { Card } from "@/components/ui/card";
import type { Quote } from "@/types/api";

import type { UnavailableItem } from "./overview-model";
import { SectionHeading } from "./section-heading";

interface PopularStocksProps {
  quotes: Quote[];
  unavailable: UnavailableItem[];
  receivedAt: number;
}

/** Server-configured popular stocks, with unavailable ones shown in place. */
export function PopularStocks({ quotes, unavailable, receivedAt }: PopularStocksProps) {
  return (
    <section aria-labelledby="popular-title" className="space-y-3">
      <SectionHeading id="popular-title">หุ้นยอดนิยม</SectionHeading>
      <Card className="rounded-[1.5rem] px-3.5 py-1.5">
        <ul className="divide-y divide-dashed divide-line">
          {quotes.map((q) => (
            <QuoteRow key={q.symbol} quote={q} receivedAt={receivedAt} avatarShape="square" />
          ))}
          {unavailable.map((u) => (
            <UnavailableQuoteRow
              key={u.symbol}
              symbol={u.symbol}
              reason={u.label}
              avatarShape="square"
            />
          ))}
        </ul>
      </Card>
    </section>
  );
}
