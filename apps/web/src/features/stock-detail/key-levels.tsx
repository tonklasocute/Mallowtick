"use client";

import { ChartSpline } from "lucide-react";
import type { ReactNode } from "react";

import { ApiErrorState } from "@/components/market/api-error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { StateMessage } from "@/components/ui/state-message";
import { cn } from "@/lib/cn";
import { formatBarTime, formatNumber, formatSignedPercent } from "@/lib/format";
import type { LabeledLevel } from "@/lib/levels";
import type { useLevels } from "@/services/api/queries";
import type { ChartRange } from "@/types/api";

import { intervalLabel, RANGE_LABELS } from "./chart-panel";
import { CardBadge, CardHeading, DetailCard, NoteBox } from "./detail-ui";

const TYPE_LABELS: Record<LabeledLevel["type"], string> = {
  support: "แนวรับ",
  resistance: "แนวต้าน",
};

interface KeyLevelsProps {
  range: ChartRange;
  query: ReturnType<typeof useLevels>;
  levels: LabeledLevel[];
}

/** "แนวต้าน 1" from R1, "แนวรับ 2" from S2. */
const levelName = (l: LabeledLevel) => `${TYPE_LABELS[l.type]} ${l.label.slice(1)}`;

/** Strength (0–1) as five segments, like the canvas. */
function StrengthMeter({ value, type }: { value: number; type: LabeledLevel["type"] }) {
  const clamped = Math.min(Math.max(value, 0), 1);
  const filled = Math.max(Math.round(clamped * 5), clamped > 0 ? 1 : 0);
  return (
    <span
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
      aria-label={`ความแรง ${filled} จาก 5`}
      className="flex gap-[3px]"
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className={cn(
            "h-1.5 w-3.5 rounded-[3px]",
            i >= filled ? "bg-line" : type === "support" ? "bg-support" : "bg-resistance",
          )}
        />
      ))}
    </span>
  );
}

function LevelBox({ level }: { level: LabeledLevel }) {
  const support = level.type === "support";
  return (
    <li
      className={cn(
        "flex flex-col gap-2.5 rounded-[18px] border-[1.5px] p-3.5",
        support
          ? "border-support-edge bg-support-tint"
          : "border-resistance-edge bg-resistance-tint",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "rounded-full px-2.5 py-[3px] text-xs font-medium",
            support ? "bg-up-soft text-up" : "bg-down-soft text-down",
          )}
        >
          {levelName(level)}
        </span>
        <span
          className={cn(
            "tabular font-display text-[12.5px] font-extrabold",
            support ? "text-up" : "text-down",
          )}
        >
          {formatSignedPercent(level.distancePct)} จากราคาล่าสุด
        </span>
      </div>
      <div className="flex items-end justify-between gap-2">
        <span className="tabular font-display text-2xl font-black text-ink">
          {formatNumber(level.price)}
        </span>
        <span className="flex flex-col items-end gap-[5px]">
          <span className="text-[11.5px] text-slate">แตะ {level.touches} ครั้ง · ความแรง</span>
          <StrengthMeter value={level.strength} type={level.type} />
        </span>
      </div>
    </li>
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
      <ul
        aria-label={`แนวรับและแนวต้านในช่วง ${RANGE_LABELS[range]}`}
        className="flex flex-col gap-2.5"
      >
        {levels.map((l) => (
          <LevelBox key={l.label} level={l} />
        ))}
      </ul>
    );
  }

  return (
    <DetailCard aria-label="แนวรับ-แนวต้านสำคัญ">
      <CardHeading
        icon={ChartSpline}
        tone="honey"
        title="แนวรับ-แนวต้านสำคัญ"
        badge={<CardBadge>{RANGE_LABELS[range]} · ค่าที่คำนวณ</CardBadge>}
      />
      {body}
      {data && data.status === "ok" && (
        <NoteBox icon>
          คำนวณโดย Mallowtick จากแท่งเทียน {intervalLabel(data.interval)} จำนวน {data.candlesUsed}{" "}
          แท่ง (แท่งล่าสุด {formatBarTime(data.asOf, data.interval)}) ใช้จุดสวิงสูง/ต่ำที่ยืนยันแล้ว
          (±{data.method.parameters.swingWindow} แท่ง) จัดกลุ่มในระยะ{" "}
          {data.method.parameters.clusterAtrMultiple}× ATR(
          {data.method.parameters.atrPeriod}) = {formatNumber(data.tolerance)}{" "}
          ให้คะแนนจากจำนวนครั้งที่แตะ ความใหม่ และแรงเด้งของราคา {data.disclaimer}
        </NoteBox>
      )}
    </DetailCard>
  );
}
