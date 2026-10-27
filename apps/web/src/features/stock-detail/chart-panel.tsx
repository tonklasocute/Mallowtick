"use client";

import { LoaderCircle, SlidersHorizontal } from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";

import { CandlestickChart, token, type ChartLine } from "@/components/charts/candlestick-chart";
import { ApiErrorState } from "@/components/market/api-error-state";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { StateMessage } from "@/components/ui/state-message";
import { cn } from "@/lib/cn";
import { ema } from "@/lib/ema";
import { formatBarTime, formatNumber } from "@/lib/format";
import type { LabeledLevel } from "@/lib/levels";
import type { useCandles } from "@/services/api/queries";
import { CHART_RANGES, type CandleSeries, type ChartRange } from "@/types/api";

import { useChartPrefs } from "./chart-prefs";
import { DeltaPill, DetailCard, Tile, TileGrid } from "./detail-ui";
import { EMA_COLOR_TOKENS, EmaSettingsSheet } from "./ema-settings-sheet";

export const RANGE_LABELS: Record<ChartRange, string> = {
  "1d": "1D",
  "1w": "1W",
  "1m": "1M",
  "3m": "3M",
  "1y": "1Y",
  "5y": "5Y",
};

const RANGE_SPANS: Record<ChartRange, string> = {
  "1d": "1 วัน",
  "1w": "1 สัปดาห์",
  "1m": "1 เดือน",
  "3m": "3 เดือน",
  "1y": "1 ปี",
  "5y": "5 ปี",
};

const INTERVAL_LABELS: Record<string, string> = {
  "5min": "5 นาที",
  "30min": "30 นาที",
  "1h": "1 ชั่วโมง",
  "1day": "รายวัน",
  "1week": "รายสัปดาห์",
};

export const intervalLabel = (interval: string) => INTERVAL_LABELS[interval] ?? interval;

const candleLabel = (interval: string) => {
  const label = intervalLabel(interval);
  return label.startsWith("ราย") ? `แท่งเทียน${label}` : `แท่งเทียน ${label}`;
};

const lineLabel = (interval: string) => {
  const label = intervalLabel(interval);
  return label.startsWith("ราย") ? `กราฟเส้นราคาปิด${label}` : `กราฟเส้นราคาปิด ${label}`;
};

const CHART_HEIGHT = 300;
/** Above this many bars (1Y, 5Y) candles get too thin to read, so the chart draws a close line. */
const MAX_CANDLES = 140;

interface ChartPanelProps {
  range: ChartRange;
  onRangeChange: (range: ChartRange) => void;
  candles: ReturnType<typeof useCandles>;
  levels: LabeledLevel[];
}

interface Ohlc {
  open: number;
  high: number;
  low: number;
  close: number;
  /** Close before the range that the change is measured from. */
  base: number;
}

/** The whole range; the chart's tooltip shows a single bar. */
function ohlcFor(data: CandleSeries): Ohlc | null {
  const cs = data.candles;
  const first = cs[0];
  const last = cs.at(-1);
  if (!first || !last) return null;
  return {
    open: first.open,
    high: Math.max(...cs.map((c) => c.high)),
    low: Math.min(...cs.map((c) => c.low)),
    close: last.close,
    base: data.warmup?.at(-1)?.close ?? first.open,
  };
}

function ToggleChip({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-[7px] rounded-full border-[1.5px] pr-3 pl-2.5 text-xs transition",
        checked
          ? "border-transparent bg-cream-deep text-ink"
          : "border-dashed border-line text-slate hover:text-ink",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "relative h-3.5 w-[22px] shrink-0 rounded-full transition-colors",
          checked ? "bg-up-fill" : "bg-line",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-2.5 rounded-full bg-surface transition-[left]",
            checked ? "left-2.5" : "left-0.5",
          )}
        />
      </span>
      {label}
    </button>
  );
}

function LevelLegend() {
  return (
    <span className="inline-flex items-center gap-3.5" aria-hidden>
      <span className="inline-flex items-center gap-1.5">
        <span className="w-4 border-t-2 border-dashed border-resistance" /> แนวต้าน
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="w-4 border-t-2 border-dashed border-support" /> แนวรับ
      </span>
    </span>
  );
}

export function ChartPanel({ range, onRangeChange, candles, levels }: ChartPanelProps) {
  const { data, error, isPending, isPlaceholderData, isFetching, refetch } = candles;
  const [prefs, setPrefs] = useChartPrefs();
  const [hover, setHover] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const gearRef = useRef<HTMLButtonElement>(null);
  const options = CHART_RANGES.map((r) => ({ value: r, label: RANGE_LABELS[r] }));

  // EMA runs over warm-up + visible closes, then is cut back to the visible bars.
  const emaLines = useMemo(() => {
    if (!data || !prefs.showEma) return [];
    const warmup = data.warmup ?? [];
    const closes = [...warmup, ...data.candles].map((c) => c.close);
    return prefs.ema.flatMap((s, slot) =>
      s.enabled
        ? [{ slot, period: s.period, values: ema(closes, s.period).slice(warmup.length) }]
        : [],
    );
  }, [data, prefs.showEma, prefs.ema]);

  const chartLines: ChartLine[] = useMemo(
    () =>
      emaLines.map((l) => ({
        key: `ema-${l.slot}-${l.period}`,
        color: token(EMA_COLOR_TOKENS[l.slot]!.name, EMA_COLOR_TOKENS[l.slot]!.fallback),
        values: l.values,
      })),
    [emaLines],
  );

  const shownLevels = prefs.showLevels ? levels : [];
  const ohlc = data ? ohlcFor(data) : null;
  const kind = data && data.candles.length > MAX_CANDLES ? "line" : "candles";
  const legendIndex = hover ?? (data ? data.candles.length - 1 : -1);
  const short = emaLines.filter((l) => l.values.every((v) => v === null));

  let body: ReactNode;
  if (isPending) {
    body = <Skeleton className="h-full w-full rounded-2xl" />;
  } else if (!data) {
    body = <ApiErrorState error={error} onRetry={() => void refetch()} compact />;
  } else if (data.candles.length === 0) {
    body = (
      <StateMessage
        compact
        title="ไม่มีประวัติราคาในช่วงนี้"
        description="ผู้ให้บริการไม่ได้ส่งข้อมูลแท่งเทียนมา ลองเลือกช่วงเวลาอื่น"
      />
    );
  } else {
    body = (
      <CandlestickChart
        series={data}
        lines={chartLines}
        levels={shownLevels}
        showVolume={prefs.showVolume}
        kind={kind}
        intraday={["1d", "1w"].includes(range)}
        height={CHART_HEIGHT}
        onHover={setHover}
      />
    );
  }

  const last = data?.candles.at(-1);
  return (
    <DetailCard aria-label="กราฟราคา">
      <SegmentedControl
        label="ช่วงเวลาของกราฟ"
        options={options}
        value={range}
        onChange={(r) => {
          setHover(null);
          onRangeChange(r);
        }}
      />

      {ohlc && (
        <>
          <TileGrid cols={4}>
            <Tile size="sm" label="เปิด" value={formatNumber(ohlc.open)} />
            <Tile size="sm" label="สูง" value={formatNumber(ohlc.high)} />
            <Tile size="sm" label="ต่ำ" value={formatNumber(ohlc.low)} />
            <Tile size="sm" label="ปิด" value={formatNumber(ohlc.close)} />
          </TileGrid>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11.5px] text-slate">เปลี่ยนแปลงในช่วง {RANGE_SPANS[range]}</span>
            <DeltaPill
              change={ohlc.close - ohlc.base}
              changePercent={ohlc.base ? ((ohlc.close - ohlc.base) / ohlc.base) * 100 : null}
            />
          </div>
        </>
      )}

      <div className="flex items-start justify-between gap-2">
        {/* Wraps like the canvas when the chips don't fit beside the gear (most phones). */}
        <div className="flex min-w-0 flex-wrap gap-1.5">
          <ToggleChip
            label="EMA"
            checked={prefs.showEma}
            onChange={(v) => setPrefs({ ...prefs, showEma: v })}
          />
          <ToggleChip
            label="แนวรับ-แนวต้าน"
            checked={prefs.showLevels}
            onChange={(v) => setPrefs({ ...prefs, showLevels: v })}
          />
          <ToggleChip
            label="วอลุ่ม"
            checked={prefs.showVolume}
            onChange={(v) => setPrefs({ ...prefs, showVolume: v })}
          />
        </div>
        <button
          ref={gearRef}
          type="button"
          aria-label="ตั้งค่าเส้น EMA"
          title="ตั้งค่าเส้น EMA"
          onClick={() => setSettingsOpen(true)}
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-ink transition hover:bg-cream-deep"
        >
          <SlidersHorizontal aria-hidden className="size-[18px]" />
        </button>
      </div>

      {prefs.showEma && (
        <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5 font-display text-[11.5px] font-extrabold">
          {emaLines.map((l) => {
            const v = l.values[legendIndex];
            return (
              <li key={l.slot} className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="h-1 w-3.5 rounded-full"
                  style={{ backgroundColor: `var(--color-${EMA_COLOR_TOKENS[l.slot]!.name})` }}
                />
                <span className="text-slate">EMA{l.period}</span>
                <span className="tabular text-ink">
                  {v === null || v === undefined ? "—" : formatNumber(v)}
                </span>
              </li>
            );
          })}
          {prefs.ema.every((s) => !s.enabled) && (
            <li className="col-span-2 font-sans font-normal text-slate">ปิดเส้น EMA ไว้ทั้งหมด</li>
          )}
        </ul>
      )}

      <div className="relative" style={{ height: CHART_HEIGHT }}>
        {body}
        {isFetching && isPlaceholderData && (
          <span
            role="status"
            className="absolute top-1 left-1 inline-flex items-center gap-1 rounded-full bg-surface/90 px-2 py-0.5 text-[11px] text-slate"
          >
            <LoaderCircle aria-hidden className="size-3 animate-spin" /> กำลังโหลด{" "}
            {RANGE_LABELS[range]}…
          </span>
        )}
      </div>

      {data && last && (
        <div className="flex flex-col gap-1.5 text-[11.5px] font-light text-slate">
          {prefs.showEma && short.length > 0 && (
            <p>
              ข้อมูลย้อนหลังไม่พอคำนวณ {short.map((l) => `EMA${l.period}`).join(", ")} ในช่วงนี้
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            <span>
              {kind === "line" ? lineLabel(data.interval) : candleLabel(data.interval)} ·{" "}
              {RANGE_SPANS[range]} · แท่งล่าสุด {formatBarTime(last.time, data.interval)}
              {data.freshness.stale && (
                <strong className="ml-1 text-down">
                  · ข้อมูลเก่า (ผู้ให้บริการไม่พร้อมใช้งาน)
                </strong>
              )}
            </span>
            {shownLevels.length > 0 && <LevelLegend />}
          </div>
        </div>
      )}

      {settingsOpen && (
        <EmaSettingsSheet
          value={prefs.ema}
          onSave={(ema) => setPrefs({ ...prefs, ema, showEma: true })}
          onClose={() => {
            setSettingsOpen(false);
            gearRef.current?.focus();
          }}
        />
      )}
    </DetailCard>
  );
}
