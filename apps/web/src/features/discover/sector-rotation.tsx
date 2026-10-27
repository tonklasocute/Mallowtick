"use client";

import Link from "next/link";
import { type ReactNode, useState } from "react";

import { ApiErrorState } from "@/components/market/api-error-state";
import { Card } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { StateMessage } from "@/components/ui/state-message";
import { SourceNote } from "@/features/stock-detail/detail-ui";
import { useInView } from "@/hooks/use-in-view";
import { cn } from "@/lib/cn";
import { formatSignedChange, formatSignedPercent } from "@/lib/format";
import { isApiError } from "@/services/api/client";
import { useSectors } from "@/services/api/queries";
import type { SectorPeriod } from "@/types/api";

import { SectionHeading } from "./section-heading";
import {
  buildSectorModel,
  heatLevel,
  SECTOR_PERIODS,
  type SectorRow,
  type TileSize,
  tileSizes,
} from "./sector-model";

/*
 * After the "กลุ่มอุตสาหกรรมเทียบตลาด" card of the Claude design canvas (Home): period
 * tabs, a dark card for the leading sector, a mosaic heatmap coloured by the gap to the
 * S&P 500, and a colour scale. Every number comes from /market/sectors.
 */

const isNum = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** Heatmap fills, weakest to strongest; the outer two take white text. */
const HEAT = [
  "bg-heat-0 text-surface",
  "bg-heat-1 text-ink",
  "bg-heat-2 text-ink",
  "bg-heat-3 text-ink",
  "bg-heat-4 text-ink",
  "bg-heat-5 text-surface",
] as const;

function Crown({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="fill-honey-ink">
      <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" />
    </svg>
  );
}

/** The strongest sector on the dark card, with the index and the weakest sector beside it. */
function LeaderSpot({
  leader,
  weakest,
  benchmark,
  periodTitle,
}: {
  leader: SectorRow & { value: number };
  weakest: (SectorRow & { value: number }) | null;
  benchmark: number | null;
  periodTitle: string;
}) {
  const pill = "rounded-full px-2.5 py-[5px] font-display text-[11.5px] font-extrabold";
  return (
    <div className="relative flex flex-col gap-2.5 overflow-hidden rounded-[22px] bg-ink p-4 text-surface">
      <span
        aria-hidden
        className="absolute -top-[70px] -right-[60px] size-[180px] rounded-full border-2 border-dashed border-heat-4/35 motion-safe:animate-orbit"
      />
      <span
        aria-hidden
        className="absolute -top-[30px] -right-5 size-[110px] rounded-full border-2 border-surface/8"
      />
      <span className="relative inline-flex items-center gap-1.5 self-start rounded-full bg-surface/12 py-1 pr-2.5 pl-1.5 text-[11.5px] text-spot-soft">
        <span className="grid size-5 place-items-center rounded-full bg-gold">
          <Crown size={12} />
        </span>
        กลุ่มที่นำตลาด · {periodTitle}
      </span>
      <div className="relative flex items-end justify-between gap-2.5">
        <span className="min-w-0">
          <b className="block truncate text-[22px] leading-[1.2] font-medium">{leader.name}</b>
          <small className="font-display text-xs font-extrabold tracking-[0.5px] text-spot-muted">
            {leader.symbol}
          </small>
        </span>
        <span className="tabular inline-block font-display text-[40px] leading-none font-black tracking-[-1px] text-spot-up motion-safe:animate-pop">
          {formatSignedPercent(leader.value)}
        </span>
      </div>
      <div className="relative flex flex-wrap gap-1.5">
        {isNum(leader.relative) && (
          <span className={cn(pill, "bg-spot-up text-spot-deep")}>
            {leader.relative >= 0 ? "ชนะตลาด" : "แพ้ตลาด"} {formatSignedPercent(leader.relative)}
          </span>
        )}
        {isNum(benchmark) && (
          <span className={cn(pill, "bg-surface/10 text-spot-text")}>
            S&P 500 {formatSignedPercent(benchmark)}
          </span>
        )}
        {weakest && (
          <span className={cn(pill, "bg-surface/10 text-spot-text")}>
            อ่อนสุด: {weakest.name} {formatSignedPercent(weakest.value)}
          </span>
        )}
      </div>
    </div>
  );
}

/** Screen-reader text for a tile, since its visible text is split into pieces. */
function tileLabel(row: SectorRow): string {
  const value = isNum(row.value) ? formatSignedPercent(row.value) : "ยังไม่มีข้อมูล";
  if (!isNum(row.relative)) return `${row.name} ${row.symbol} ${value}`;
  const side = row.relative >= 0 ? "แรงกว่า" : "อ่อนกว่า";
  return `${row.name} ${row.symbol} ${value}, ${side} S&P 500 ${formatSignedChange(Math.abs(row.relative))} จุด`;
}

function Tile({ row, size }: { row: SectorRow; size: TileSize }) {
  const grade = row.relative ?? row.value;
  const percent = !isNum(row.value) && row.waiting ? "รอโควตา" : formatSignedPercent(row.value);
  const gap = isNum(row.relative) ? formatSignedChange(row.relative) : null;
  const ticker = (
    <i className="font-display text-[10px] font-extrabold not-italic opacity-75">{row.symbol}</i>
  );
  const big = (
    <strong
      className={cn(
        "tabular font-display font-black tracking-[-0.3px]",
        size === "xl" ? "block text-[30px] leading-tight" : "text-[17px]",
      )}
    >
      {percent}
    </strong>
  );
  const small = (text: string) => (
    <em
      className={cn(
        "font-display font-extrabold not-italic opacity-80",
        size === "xl" ? "text-[11.5px]" : "text-[10px]",
      )}
    >
      {text}
    </em>
  );

  return (
    <li className={cn(size === "xl" && "col-span-2 row-span-2", size === "wide" && "col-span-2")}>
      <Link
        href={`/stocks/${encodeURIComponent(row.symbol)}`}
        aria-label={tileLabel(row)}
        title={row.name}
        className={cn(
          "relative flex h-full min-w-0 flex-col justify-between overflow-hidden rounded-[18px] transition-transform duration-200 motion-safe:hover:-translate-y-[3px] motion-safe:hover:-rotate-[0.6deg]",
          // 1×1 tiles take 8px sides instead of the canvas's 10px, so "สินค้าจำเป็น" fits.
          size === "xl" ? "p-3.5" : size === "wide" ? "px-2.5 py-[9px]" : "px-2 py-[9px]",
          HEAT[isNum(grade) ? heatLevel(grade) : 2],
        )}
      >
        {size === "xl" ? (
          <>
            <span className="absolute top-2.5 right-2.5 grid size-[30px] place-items-center rounded-full bg-gold shadow-medal motion-safe:animate-medal">
              <Crown size={16} />
            </span>
            <span className="min-w-0 pr-9">
              <b className="block truncate text-base font-normal">{row.name}</b>
              {ticker}
            </span>
            <span>
              {big}
              {gap && small(`vs ตลาด ${gap}`)}
            </span>
          </>
        ) : size === "wide" ? (
          <>
            <span className="flex min-w-0 items-baseline gap-1">
              <b className="truncate text-xs font-normal">{row.name}</b>
              {ticker}
            </span>
            <span className="flex items-baseline gap-1">
              {big}
              {gap && small(gap)}
            </span>
          </>
        ) : (
          <>
            <b className="truncate text-xs font-normal">{row.shortName}</b>
            {big}
            {gap ? small(gap) : <span />}
          </>
        )}
      </Link>
    </li>
  );
}

function HeatScale({ vsIndex }: { vsIndex: boolean }) {
  return (
    <div className="flex items-center gap-2 text-[11px] text-slate">
      <span>{vsIndex ? "อ่อนกว่าตลาด" : "ลดลง"}</span>
      <span aria-hidden className="flex flex-1 gap-[3px]">
        {HEAT.map((h) => (
          <i key={h} className={cn("h-2 flex-1 rounded-[4px]", h.split(" ")[0])} />
        ))}
      </span>
      <span>{vsIndex ? "แรงกว่าตลาด" : "เพิ่มขึ้น"}</span>
    </div>
  );
}

function SectorSkeleton() {
  return (
    <div aria-busy="true" aria-label="กำลังโหลดกลุ่มอุตสาหกรรม" className="space-y-2">
      <Skeleton className="h-36 w-full rounded-[22px]" />
      <div className="grid auto-rows-[74px] grid-cols-4 gap-1.5">
        <Skeleton className="col-span-2 row-span-2 h-full rounded-[18px]" />
        <Skeleton className="col-span-2 h-full rounded-[18px]" />
        <Skeleton className="h-full rounded-[18px]" />
        <Skeleton className="h-full rounded-[18px]" />
      </div>
    </div>
  );
}

/**
 * The S&P 500 sectors ranked by return over a period, against the index. These are
 * price returns of the sector ETFs; free data has no fund flows. Fetched once the
 * section is near the screen, since every sector is a provider call.
 */
export function SectorRotation() {
  const [ref, inView] = useInView<HTMLElement>();
  const [period, setPeriod] = useState<SectorPeriod>("1d");
  const { data, error, isPending, refetch } = useSectors(inView);

  let body: ReactNode;
  if (data) {
    const m = buildSectorModel(data, period);
    const ranked = m.rows.filter((r): r is SectorRow & { value: number } => isNum(r.value));
    const leader = ranked[0];
    const weakest = ranked.length > 1 ? ranked[ranked.length - 1]! : null;
    const sizes = tileSizes(m.rows.length);
    const vsIndex = isNum(m.benchmark);
    const periodTitle = SECTOR_PERIODS.find((p) => p.value === period)?.title ?? period;
    body = (
      <>
        <SegmentedControl
          label="ช่วงเวลา"
          options={SECTOR_PERIODS}
          value={period}
          onChange={setPeriod}
        />
        {leader && (
          <LeaderSpot
            leader={leader}
            weakest={weakest}
            benchmark={m.benchmark}
            periodTitle={periodTitle}
          />
        )}
        {m.rows.length > 0 && (
          <ul aria-label="ผลตอบแทนแต่ละกลุ่ม" className="grid auto-rows-[74px] grid-cols-4 gap-1.5">
            {m.rows.map((r, i) => (
              <Tile key={r.symbol} row={r} size={sizes[i] ?? "one"} />
            ))}
          </ul>
        )}
        {m.unavailable.length > 0 && (
          <p role="status" className="text-[11px] text-slate">
            ยังไม่มีข้อมูล: {m.unavailable.map((u) => `${u.name} (${u.label})`).join(", ")}
          </p>
        )}
        <HeatScale vsIndex={vsIndex} />
        <SourceNote freshness={data.freshness} icon>
          {vsIndex
            ? "สีของช่องบอกผลต่างจาก S&P 500 (ยิ่งเขียวเข้ม = ยิ่งแรงกว่าตลาด) · ตัวเลขใหญ่คือผลตอบแทนของกลุ่ม ตัวเล็กคือผลต่างจากตลาด"
            : "ยังไม่มีผลตอบแทนของ S&P 500 ในช่วงนี้ สีของช่องจึงบอกผลตอบแทนของแต่ละกลุ่มเอง"}{" "}
          · เป็นผลตอบแทนราคาของ ETF ประจำกลุ่ม ไม่ใช่ข้อมูลเงินไหลเข้า-ออก
        </SourceNote>
      </>
    );
  } else if (isPending) {
    body = <SectorSkeleton />;
  } else if (isApiError(error) && error.code === "provider_not_configured") {
    body = (
      <StateMessage
        compact
        title="ยังไม่ได้ตั้งค่าแหล่งข้อมูลกลุ่มอุตสาหกรรม"
        description="ตั้งค่า FINNHUB_API_KEY ที่เซิร์ฟเวอร์ API ของ Mallowtick เพื่อดูผลตอบแทนของแต่ละกลุ่ม"
      />
    );
  } else {
    body = <ApiErrorState error={error} onRetry={() => void refetch()} compact />;
  }

  return (
    <section ref={ref} aria-labelledby="sectors-title" className="space-y-3 lg:max-w-2xl">
      <SectionHeading id="sectors-title">กลุ่มอุตสาหกรรมเทียบตลาด</SectionHeading>
      <Card className="flex flex-col gap-3 rounded-3xl p-4">{body}</Card>
    </section>
  );
}
