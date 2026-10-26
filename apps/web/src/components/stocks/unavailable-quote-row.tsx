import Link from "next/link";
import type { ReactNode } from "react";

import { SymbolAvatar } from "./symbol-avatar";

/** List row for a symbol whose quote couldn't be loaded. Shows no price. */
export function UnavailableQuoteRow({
  symbol,
  reason,
  trailing,
}: {
  symbol: string;
  reason: string;
  trailing?: ReactNode;
}) {
  return (
    <li className="flex items-center gap-2">
      <Link
        href={`/stocks/${encodeURIComponent(symbol)}`}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-1 py-2.5 transition hover:bg-cream"
      >
        <span className="opacity-60">
          <SymbolAvatar symbol={symbol} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-[15px] font-semibold text-ink">{symbol}</span>
          <span className="block text-xs text-slate">ไม่มีข้อมูลราคา</span>
        </span>
        <span className="shrink-0 rounded-full bg-cream-deep px-2 py-0.5 text-[11px] font-semibold text-slate-strong">
          {reason}
        </span>
      </Link>
      {trailing}
    </li>
  );
}
