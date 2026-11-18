import Link from "next/link";

import { cn } from "@/lib/cn";
import { formatMarketTime } from "@/lib/format";
import { vendorLabel } from "@/lib/providers";
import { formatFact } from "@/lib/research";
import type { Insight } from "@/types/api";

const TONE_BAR: Record<Insight["tone"], string> = {
  up: "bg-up-fill",
  down: "bg-down-fill",
  neutral: "bg-sky",
};

/**
 * One rule-based observation: what was found, the numbers it rests on, where they come from,
 * how complete they were, and the rule behind it.
 */
export function InsightCard({ insight, now }: { insight: Insight; now?: Date }) {
  const sources = insight.sources.map(vendorLabel).join(", ");
  return (
    <article
      aria-label={insight.title}
      className="relative overflow-hidden rounded-[20px] border border-line bg-surface p-3.5 pl-4.5 shadow-soft"
    >
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1.5", TONE_BAR[insight.tone])} />
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[15px] font-medium text-ink">
          {insight.symbol && insight.scope === "symbol" ? (
            <Link
              href={`/stocks/${encodeURIComponent(insight.symbol)}`}
              className="hover:underline"
            >
              {insight.title}
            </Link>
          ) : (
            insight.title
          )}
        </h3>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[10.5px] whitespace-nowrap",
            insight.completeness === "complete"
              ? "bg-mint-soft text-mint-deep"
              : "bg-honey text-honey-ink",
          )}
        >
          {insight.completeness === "complete" ? "ข้อมูลครบ" : "ข้อมูลบางส่วน"}
        </span>
      </div>
      <p className="mt-1 text-[12.5px] leading-relaxed text-slate-strong">{insight.explanation}</p>
      {insight.facts.length > 0 && (
        <dl className="mt-2.5 grid grid-cols-2 gap-1.5">
          {insight.facts.map((f) => (
            <div
              key={f.label}
              className={cn(
                "min-w-0 rounded-xl bg-cream-deep px-2.5 py-1.5",
                f.unit === "text" && f.text && f.text.length > 24 && "col-span-2",
              )}
            >
              <dt className="truncate text-[11px] text-slate">{f.label}</dt>
              <dd
                lang={f.unit === "text" && /[A-Za-z]{4}/.test(f.text ?? "") ? "en" : undefined}
                className="tabular font-display text-[13px] font-extrabold break-words text-ink"
              >
                {formatFact(f)}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <details className="mt-2 text-[11.5px] text-slate">
        <summary className="cursor-pointer">
          {insight.reliability === "high" ? "ข้อมูลจากผู้ให้บริการ" : "คำนวณจากข้อมูลผู้ให้บริการ"}{" "}
          · {sources}
          {insight.asOf && ` · ${formatMarketTime(insight.asOf, now)}`}
        </summary>
        <p className="mt-1">วิธีคิด: {insight.method}</p>
      </details>
    </article>
  );
}
