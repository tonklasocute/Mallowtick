import Link from "next/link";
import type { ReactNode } from "react";

import { FreshnessInline } from "@/components/market/freshness-badge";
import { PriceChange } from "@/components/market/price-change";
import { formatPrice } from "@/lib/format";
import type { Quote } from "@/types/api";

import { type AvatarShape, SymbolAvatar } from "./symbol-avatar";

interface QuoteRowProps {
  quote: Quote;
  receivedAt: number;
  avatarShape?: AvatarShape;
  /** Optional middle content such as a sparkline. */
  middle?: ReactNode;
  /** Optional trailing control (e.g. remove button); rendered outside the link. */
  trailing?: ReactNode;
}

export function QuoteRow({ quote, receivedAt, avatarShape, middle, trailing }: QuoteRowProps) {
  return (
    <li className="flex items-center gap-2">
      <Link
        href={`/stocks/${encodeURIComponent(quote.symbol)}`}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-1 py-2.5 transition hover:bg-cream"
      >
        <SymbolAvatar symbol={quote.symbol} logo={quote.logo} shape={avatarShape} />
        <span className="min-w-0 flex-1">
          <span className="block font-display text-[15px] font-semibold text-ink">
            {quote.symbol}
          </span>
          <span className="block truncate text-xs text-slate">{quote.name || quote.exchange}</span>
        </span>
        {middle}
        <span className="flex shrink-0 flex-col items-end gap-0.5">
          <span className="tabular text-[15px] font-semibold text-ink">
            {formatPrice(quote.price, quote.currency)}
          </span>
          <PriceChange
            change={quote.change}
            changePercent={quote.changePercent}
            variant="pill"
            showAbsolute={false}
          />
          <FreshnessInline
            freshness={quote.freshness}
            isMarketOpen={quote.isMarketOpen}
            receivedAt={receivedAt}
          />
        </span>
      </Link>
      {trailing}
    </li>
  );
}
