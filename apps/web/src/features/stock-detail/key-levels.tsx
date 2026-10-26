"use client";

import type { ReactNode } from "react";
import { ApiErrorState } from "@/components/market/api-error-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StateMessage } from "@/components/ui/state-message";
import { cn } from "@/lib/cn";
import { formatBarTime, formatNumber, formatSignedPercent } from "@/lib/format";
import type { LabeledLevel } from "@/lib/levels";
import type { useLevels } from "@/services/api/queries";
import type { ChartRange } from "@/types/api";

import { intervalLabel, RANGE_LABELS } from "./chart-panel";

const TYPE_LABELS: Record<LabeledLevel["type"], string> = {
  support: "แนวรับ",
  resistance: "แนวต้าน",
};

interface KeyLevelsProps {
  range: ChartRange;
  query: ReturnType<typeof useLevels>;
  levels: LabeledLevel[];
}

function StrengthBar({ value, type }: { value: number; type: LabeledLevel["type"] }) {
  const pct = Math.round(Math.min(Math.max(value, 0), 1) * 100);
  return (
    <span
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label="ความแรง"
      className="block h-1.5 w-14 overflow-hidden rounded-full bg-cream-deep"
    >
      <span
        className={cn(
          "block h-full rounded-full",
          type === "support" ? "bg-support" : "bg-resistance",
        )}
        style={{ width: `${pct}%` }}
      />
    </span>
  );
}

export function KeyLevels({ range, query, levels }: KeyLevelsProps) {
  const { data, error, isPending, refetch } = query;

  let body: ReactNode;
  if (isPending) {
    body = (
      <div aria-busy="true" aria-label="กำลังคำนวณแนวรับ-แนวต้าน" className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  } else if (!data) {
    body = <ApiErrorState error={error} onRetry={() => void refetch()} compact />;
  } else if (data.status === "insufficient_data") {
    body = (
      <StateMessage
        compact
        title="ข้อมูลย้อนหลังไม่พอ"
        description={`ช่วงนี้มีแท่งเทียนที่ใช้ได้เพียง ${data.candlesUsed} แท่ง ต้องมีอย่างน้อย ${data.method.parameters.swingWindow * 2 + 1} แท่งจึงจะยืนยันจุดสวิงได้`}
      />
    );
  } else if (levels.length === 0) {
    body = (
      <StateMessage
        compact
        title="ไม่พบแนวรับ-แนวต้านที่ชัดเจนในช่วงนี้"
        description="ไม่พบจุดสวิงสูงหรือต่ำที่ยืนยันแล้ว ลองเลือกช่วงเวลาที่ยาวขึ้น"
      />
    );
  } else {
    body = (
      <table className="w-full text-sm">
        <caption className="sr-only">แนวรับและแนวต้านในช่วง {RANGE_LABELS[range]}</caption>
        <thead className="text-left text-[11px] text-slate">
          <tr>
            <th scope="col" className="pb-1 font-medium">
              ระดับ
            </th>
            <th scope="col" className="pb-1 text-right font-medium">
              ราคา
            </th>
            <th scope="col" className="pb-1 text-right font-medium">
              ห่างจากราคาล่าสุด
            </th>
            <th scope="col" className="pb-1 text-right font-medium">
              แตะ (ครั้ง)
            </th>
            <th scope="col" className="pb-1 pl-3 font-medium">
              ความแรง
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {levels.map((l) => (
            <tr key={l.label}>
              <th scope="row" className="py-2 text-left font-normal">
                <span
                  className={cn(
                    "inline-flex rounded-md border-l-[3px] px-1.5 text-xs font-semibold",
                    l.type === "support"
                      ? "border-support bg-mint-soft text-mint-deep"
                      : "border-resistance bg-accent-soft text-down",
                  )}
                >
                  {l.label}
                </span>
                <span className="sr-only"> {TYPE_LABELS[l.type]}</span>
              </th>
              <td className="tabular py-2 text-right font-semibold text-ink">
                {formatNumber(l.price)}
              </td>
              <td className="tabular py-2 text-right text-xs text-slate-strong">
                {formatSignedPercent(l.distancePct)}
              </td>
              <td className="tabular py-2 text-right text-xs text-slate-strong">{l.touches}</td>
              <td className="py-2 pl-3">
                <StrengthBar value={l.strength} type={l.type} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <CardTitle>แนวรับ-แนวต้านสำคัญ</CardTitle>
        <Badge tone="sky">{RANGE_LABELS[range]} · ค่าที่คำนวณ</Badge>
      </div>
      {body}
      {data && data.status === "ok" && (
        <p className="mt-3 text-[11px] leading-relaxed text-slate">
          คำนวณโดย Mallowtick จากแท่งเทียน {intervalLabel(data.interval)} จำนวน {data.candlesUsed}{" "}
          แท่ง (แท่งล่าสุด {formatBarTime(data.asOf, data.interval)}) ใช้จุดสวิงสูง/ต่ำที่ยืนยันแล้ว
          (±{data.method.parameters.swingWindow} แท่ง) จัดกลุ่มในระยะ{" "}
          {data.method.parameters.clusterAtrMultiple}× ATR(
          {data.method.parameters.atrPeriod}) = {formatNumber(data.tolerance)}{" "}
          ให้คะแนนจากจำนวนครั้งที่แตะ ความใหม่ และแรงเด้งของราคา {data.disclaimer}
        </p>
      )}
    </Card>
  );
}
