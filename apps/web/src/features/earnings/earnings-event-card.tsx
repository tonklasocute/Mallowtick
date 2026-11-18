import Link from "next/link";

import { SymbolAvatar } from "@/components/stocks/symbol-avatar";
import { cn } from "@/lib/cn";
import {
  compareOutcome,
  formatEps,
  formatAmountCompact,
  hourLabel,
  isReported,
  OUTCOME_LABELS,
  surprisePercent,
} from "@/lib/earnings";
import { formatSignedPercent } from "@/lib/format";
import type { EarningsEvent, EarningsOutcome } from "@/types/api";

const OUTCOME_PILL: Record<Exclude<EarningsOutcome, "">, string> = {
  beat: "bg-up-soft text-up",
  miss: "bg-down-soft text-down",
  inline: "bg-cream-deep text-slate-strong",
};

/** "▲ +3.64% ดีกว่าคาด" for a reported figure, nothing when it can't be compared. */
function Outcome({ actual, estimate }: { actual: number | null; estimate: number | null }) {
  const outcome = compareOutcome(actual, estimate);
  if (!outcome) return null;
  const pct = surprisePercent(actual, estimate);
  return (
    <span
      className={cn(
        "tabular inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-display text-[11px] font-black whitespace-nowrap",
        OUTCOME_PILL[outcome],
      )}
    >
      {outcome !== "inline" && <span aria-hidden>{outcome === "beat" ? "▲ " : "▼ "}</span>}
      {pct !== null && outcome !== "inline" && `${formatSignedPercent(pct)} `}
      {OUTCOME_LABELS[outcome]}
    </span>
  );
}

/** One figure's row: the actual once reported, always the estimate, and how they compare. */
function FigureRow({
  label,
  actual,
  estimate,
  format,
  reported,
}: {
  label: string;
  actual: number | null;
  estimate: number | null;
  format: (v: number | null) => string;
  reported: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
      <dt className="text-[12px] text-slate">{label}</dt>
      <dd className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-right">
        {reported && (
          <span className="tabular font-display text-[13px] font-extrabold text-ink">
            {format(actual)}
          </span>
        )}
        <span className="tabular font-display text-[12px] font-semibold text-slate">
          {estimate === null ? "ไม่มีประมาณการ" : `คาด ${format(estimate)}`}
        </span>
        {reported && <Outcome actual={actual} estimate={estimate} />}
      </dd>
    </div>
  );
}

/** A company's report in the calendar; links to its Stock Detail. */
export function EarningsEventCard({
  event,
  mine,
  today,
}: {
  event: EarningsEvent;
  mine?: boolean;
  /** New York date; a past report without figures is said to have none, not to be coming. */
  today?: string;
}) {
  const reported = isReported(event);
  const noResults = !reported && today !== undefined && event.date < today;
  const fiscal = event.quarter && event.year ? `Q${event.quarter} ปีงบ ${event.year}` : null;
  return (
    <Link
      href={`/stocks/${encodeURIComponent(event.symbol)}`}
      className="block rounded-[20px] border border-line bg-surface p-3.5 shadow-soft transition hover:border-line-strong"
    >
      <article aria-label={`${event.symbol} ประกาศงบ`} className="space-y-2.5">
        <header className="flex items-center gap-3">
          <SymbolAvatar symbol={event.symbol} logo={event.logo} />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 font-display text-[15px] font-black text-ink">
              {event.symbol}
              {mine && (
                <span className="rounded-full bg-mint-soft px-1.5 py-px text-[10px] font-bold text-mint-deep">
                  หุ้นของฉัน
                </span>
              )}
            </p>
            <p className="truncate text-[12px] font-light text-slate">
              {[event.name, fiscal].filter(Boolean).join(" · ") || " "}
            </p>
          </div>
          <span
            className={cn(
              "shrink-0 rounded-full px-2.5 py-1 text-[11px] whitespace-nowrap",
              reported
                ? "bg-mint-soft text-mint-deep"
                : noResults
                  ? "bg-cream-deep text-slate"
                  : "bg-lavender text-lavender-ink",
            )}
          >
            {reported ? "ประกาศแล้ว" : noResults ? "ยังไม่มีผลในข้อมูล" : hourLabel(event.hour)}
          </span>
        </header>
        <dl className="space-y-1.5 rounded-2xl bg-cream-deep px-3 py-2.5">
          <FigureRow
            label="EPS"
            actual={event.epsActual}
            estimate={event.epsEstimate}
            format={formatEps}
            reported={reported}
          />
          <FigureRow
            label="รายได้"
            actual={event.revenueActual}
            estimate={event.revenueEstimate}
            format={formatAmountCompact}
            reported={reported}
          />
        </dl>
      </article>
    </Link>
  );
}
