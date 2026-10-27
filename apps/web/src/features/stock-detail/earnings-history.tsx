"use client";

import { ApiErrorState } from "@/components/market/api-error-state";
import { Card, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { EMPTY, direction, formatCalendarDate, formatSignedPercent } from "@/lib/format";
import { isApiError } from "@/services/api/client";
import { useEarningsHistory } from "@/services/api/queries";

import { SourceNote } from "./company-fundamentals";

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

const TONE = { up: "text-up", down: "text-down", flat: "text-ink", unknown: "text-ink" };

/**
 * Reported EPS against the analysts' estimate for the latest quarters. Renders nothing
 * when no vendor is configured (the company card says so) or the symbol has no reports.
 */
export function EarningsHistory({ symbol }: { symbol: string }) {
  const { data, error, isPending, refetch } = useEarningsHistory(symbol);

  if (isPending) {
    return (
      <Card>
        <CardTitle className="mb-2">ผลประกอบการล่าสุด</CardTitle>
        <div aria-busy="true" aria-label="กำลังโหลดผลประกอบการ" className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      </Card>
    );
  }
  if (!data) {
    if (isApiError(error) && error.code === "provider_not_configured") return null;
    return (
      <Card>
        <CardTitle className="mb-2">ผลประกอบการล่าสุด</CardTitle>
        <ApiErrorState error={error} onRetry={() => void refetch()} compact />
      </Card>
    );
  }
  if (data.quarters.length === 0) return null;

  // Compare in percent: direction() treats sub-cent changes as flat, but a 0.4-cent EPS beat is real.
  const reported = data.quarters.filter((q) => q.surprisePercent !== null);
  const beats = reported.filter((q) => direction(q.surprisePercent) === "up").length;

  return (
    <Card>
      <CardTitle>ผลประกอบการล่าสุด</CardTitle>
      {reported.length > 0 && (
        <p className="mt-0.5 mb-2 text-sm font-light text-slate-strong">
          กำไรต่อหุ้น (EPS) ดีกว่าที่นักวิเคราะห์คาด {beats} จาก {reported.length} ไตรมาส
        </p>
      )}
      <table className="w-full text-sm">
        <caption className="sr-only">EPS จริงเทียบกับประมาณการของนักวิเคราะห์</caption>
        <thead className="text-left text-[11px] text-slate">
          <tr>
            <th scope="col" className="pb-1 font-medium">
              ไตรมาส
            </th>
            <th scope="col" className="pb-1 text-right font-medium">
              EPS จริง
            </th>
            <th scope="col" className="pb-1 text-right font-medium">
              คาดการณ์
            </th>
            <th scope="col" className="pb-1 text-right font-medium">
              ต่างจากคาด
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {data.quarters.map((q) => (
            <tr key={q.period}>
              <th scope="row" className="py-2 text-left font-normal">
                <span className="tabular block font-semibold text-ink">
                  Q{q.quarter} {q.year}
                </span>
                <span className="block text-[11px] font-light text-slate">
                  สิ้นสุด {formatCalendarDate(q.period, "month")}
                </span>
              </th>
              <td className="tabular py-2 text-right font-semibold text-ink">
                {formatEps(q.actual)}
              </td>
              <td className="tabular py-2 text-right text-slate-strong">{formatEps(q.estimate)}</td>
              <td
                className={cn(
                  "tabular py-2 text-right font-semibold",
                  TONE[direction(q.surprisePercent)],
                )}
              >
                {formatSignedPercent(q.surprisePercent)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <SourceNote freshness={data.freshness}>
        คาดการณ์คือค่าเฉลี่ยประมาณการของนักวิเคราะห์ ไตรมาสนับตามปีบัญชีของบริษัท
      </SourceNote>
    </Card>
  );
}
