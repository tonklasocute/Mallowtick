"use client";

import { FileCheck2 } from "lucide-react";

import { ApiErrorState } from "@/components/market/api-error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { EMPTY, direction, formatCalendarDate, formatSignedPercent } from "@/lib/format";
import { isApiError } from "@/services/api/client";
import { useEarningsHistory } from "@/services/api/queries";
import type { EarningsSurprise } from "@/types/api";

import { CardHeading, DetailCard, SourceNote } from "./detail-ui";

/**
 * EPS with up to four decimals: estimates are averages like -0.0765, and rounding them to
 * cents would show "-0.08 vs -0.08" next to a 4.6% miss.
 */
function formatEps(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return EMPTY;
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(v);
}

// Compare in percent: direction() treats sub-cent changes as flat, but a 0.4-cent EPS beat is real.
const outcome = (q: EarningsSurprise) => direction(q.surprisePercent);

/** "+71.8%" for the chart labels; the table keeps two decimals. */
const shortPercent = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;

/** A round step giving three or four gridlines over span. */
function niceStep(span: number): number {
  const raw = span / 3 || 0.01;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
}

// Plot geometry in viewBox units; the SVG scales to the card's width.
const W = 324;
const H = 150;
const LEFT = 44;
const TOP = 26;
const BOTTOM = 112;

/** Actual EPS (filled, green or red) against the estimate (dashed ring), oldest quarter first. */
function EpsDotPlot({ quarters }: { quarters: EarningsSurprise[] }) {
  const values = quarters
    .flatMap((q) => [q.actual, q.estimate])
    .filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  const step = niceStep(Math.max(...values) - Math.min(...values));
  const lo = Math.floor(Math.min(...values) / step) * step;
  const hi = Math.max(Math.ceil(Math.max(...values) / step) * step, lo + step);
  const y = (v: number) => TOP + ((hi - v) / (hi - lo)) * (BOTTOM - TOP);
  const x = (i: number) => LEFT + ((i + 0.5) * (W - LEFT)) / quarters.length;
  const ticks: number[] = [];
  for (let t = hi; t >= lo - step / 2; t -= step) ticks.push(Number(t.toFixed(6)));

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="block h-auto w-full"
      role="img"
      aria-label={`EPS จริงเทียบกับคาดการณ์ ${quarters.length} ไตรมาสล่าสุด`}
    >
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={LEFT - 4}
            x2={W}
            y1={y(t)}
            y2={y(t)}
            className="stroke-grid"
            strokeWidth={1}
            strokeDasharray="2 5"
            strokeLinecap="round"
          />
          <text x={0} y={y(t) + 3.5} className="fill-slate font-display text-[10px] font-bold">
            {t.toFixed(2)}
          </text>
        </g>
      ))}
      {quarters.map((q, i) => {
        const cx = x(i);
        const beat = outcome(q) !== "down";
        const ys = [q.actual, q.estimate].filter((v): v is number => v !== null).map(y);
        const labelY = beat ? Math.min(...ys) - 12 : Math.max(...ys) + 19;
        return (
          <g key={q.period}>
            {q.actual !== null && q.estimate !== null && (
              <line
                x1={cx}
                x2={cx}
                y1={y(q.actual)}
                y2={y(q.estimate)}
                className="stroke-line-strong"
                strokeWidth={2}
                strokeDasharray="2 3"
                strokeLinecap="round"
              />
            )}
            {q.estimate !== null && (
              <circle
                cx={cx}
                cy={y(q.estimate)}
                r={6}
                className="fill-surface stroke-estimate"
                strokeWidth={2}
                strokeDasharray="3 2"
              >
                <title>{`คาดการณ์ ${formatEps(q.estimate)}`}</title>
              </circle>
            )}
            {q.actual !== null && (
              <circle
                cx={cx}
                cy={y(q.actual)}
                r={7.5}
                className={cn("stroke-surface", beat ? "fill-up-fill" : "fill-down-fill")}
                strokeWidth={2.5}
              >
                <title>{`EPS จริง ${formatEps(q.actual)}`}</title>
              </circle>
            )}
            {q.surprisePercent !== null && (
              <text
                x={cx}
                y={labelY}
                textAnchor="middle"
                className={cn(
                  "font-display text-[10px] font-black",
                  beat ? "fill-up" : "fill-down",
                )}
              >
                {shortPercent(q.surprisePercent)}
              </text>
            )}
            <text
              x={cx}
              y={138}
              textAnchor="middle"
              className="fill-ink font-display text-[11px] font-extrabold"
            >
              {`Q${q.quarter}'${String(q.year).slice(2)}`}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Reported EPS against the analysts' estimate for the latest quarters. Renders nothing
 * when no vendor is configured (the company card says so) or the symbol has no reports.
 */
export function EarningsHistory({ symbol }: { symbol: string }) {
  const { data, error, isPending, refetch } = useEarningsHistory(symbol);

  if (isPending) {
    return (
      <DetailCard aria-label="ผลประกอบการล่าสุด">
        <CardHeading icon={FileCheck2} tone="mint" title="ผลประกอบการล่าสุด" />
        <div aria-busy="true" aria-label="กำลังโหลดผลประกอบการ" className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      </DetailCard>
    );
  }
  if (!data) {
    if (isApiError(error) && error.code === "provider_not_configured") return null;
    return (
      <DetailCard aria-label="ผลประกอบการล่าสุด">
        <CardHeading icon={FileCheck2} tone="mint" title="ผลประกอบการล่าสุด" />
        <ApiErrorState error={error} onRetry={() => void refetch()} compact />
      </DetailCard>
    );
  }
  if (data.quarters.length === 0) return null;

  const chronological = [...data.quarters].reverse();
  const reported = chronological.filter((q) => q.surprisePercent !== null);
  const beats = reported.filter((q) => outcome(q) === "up").length;

  return (
    <DetailCard aria-label="ผลประกอบการล่าสุด">
      <CardHeading icon={FileCheck2} tone="mint" title="ผลประกอบการล่าสุด" />
      {reported.length > 0 && (
        <div className="flex items-center justify-between gap-2.5 rounded-2xl bg-mint-soft px-3 py-2.5">
          <p className="text-[13px] text-ink">
            EPS ดีกว่าคาด{" "}
            <b className="font-display text-[15px] font-black">
              {beats} จาก {reported.length}
            </b>{" "}
            ไตรมาส
          </p>
          <span aria-hidden className="flex gap-1">
            {reported.map((q) => {
              const dir = outcome(q);
              return (
                <i
                  key={q.period}
                  className={cn(
                    "grid size-5 place-items-center rounded-full font-display text-[11px] font-black text-surface not-italic",
                    dir === "up" ? "bg-up-fill" : dir === "down" ? "bg-down-fill" : "bg-faint",
                  )}
                >
                  {dir === "up" ? "✓" : dir === "down" ? "✕" : "–"}
                </i>
              );
            })}
          </span>
        </div>
      )}

      <EpsDotPlot quarters={chronological} />
      <div aria-hidden className="flex gap-3.5 text-[11.5px] text-slate">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-up-fill" />
          EPS จริง
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full border-2 border-dashed border-estimate" />
          คาดการณ์
        </span>
      </div>

      <table className="w-full">
        <caption className="sr-only">EPS จริงเทียบกับประมาณการของนักวิเคราะห์</caption>
        <thead className="border-b border-line text-[11px] text-slate">
          <tr>
            <th scope="col" className="pb-0.5 text-left font-normal">
              ไตรมาส
            </th>
            <th scope="col" className="pb-0.5 text-right font-normal">
              จริง / คาด
            </th>
            <th scope="col" className="pb-0.5 text-right font-normal">
              ต่างจากคาด
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-dashed divide-line">
          {data.quarters.map((q) => {
            const dir = outcome(q);
            return (
              <tr key={q.period}>
                <th scope="row" className="py-[11px] text-left font-normal">
                  <b className="tabular block font-display text-sm font-black text-ink">
                    Q{q.quarter} {q.year}
                  </b>
                  <small className="text-[11px] font-light text-slate">
                    สิ้นสุด {formatCalendarDate(q.period, "month")}
                  </small>
                </th>
                <td className="py-[11px] text-right">
                  <span className="tabular block font-display text-[13px] font-extrabold text-ink">
                    {formatEps(q.actual)}
                  </span>
                  <span className="tabular block font-display text-[11px] font-semibold text-slate">
                    คาด {formatEps(q.estimate)}
                  </span>
                </td>
                <td className="py-[11px] text-right">
                  <span
                    className={cn(
                      "tabular inline-block rounded-full px-[9px] py-1 font-display text-xs font-black whitespace-nowrap",
                      dir === "up"
                        ? "bg-up-soft text-up"
                        : dir === "down"
                          ? "bg-down-soft text-down"
                          : "bg-cream-deep text-slate-strong",
                    )}
                  >
                    {(dir === "up" || dir === "down") && (
                      <span aria-hidden>{dir === "up" ? "▲ " : "▼ "}</span>
                    )}
                    {formatSignedPercent(q.surprisePercent)}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <SourceNote freshness={data.freshness}>
        คาดการณ์คือค่าเฉลี่ยประมาณการของนักวิเคราะห์ ไตรมาสนับตามปีบัญชีของบริษัท
      </SourceNote>
    </DetailCard>
  );
}
