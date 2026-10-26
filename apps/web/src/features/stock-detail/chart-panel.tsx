"use client";

import { LoaderCircle, SlidersHorizontal } from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";

import { CandlestickChart, token, type ChartLine } from "@/components/charts/candlestick-chart";
import { ApiErrorState } from "@/components/market/api-error-state";
import { PriceChange } from "@/components/market/price-change";
import { Card } from "@/components/ui/card";
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

const CHART_HEIGHT = 300;

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
  /** Close before the bar (or before the range) that the change is measured from. */
  base: number;
}

/** The hovered bar, or the whole range when nothing is hovered. */
function ohlcFor(data: CandleSeries, hover: number | null): Ohlc | null {
  const cs = data.candles;
  const first = cs[0];
  const last = cs.at(-1);
  if (!first || !last) return null;
  const bar = hover === null ? undefined : cs[hover];
  if (bar && hover !== null) {
    const prev = hover > 0 ? cs[hover - 1]!.close : data.warmup?.at(-1)?.close;
    return { ...bar, base: prev ?? bar.open };
  }
  return {
    open: first.open,
    high: Math.max(...cs.map((c) => c.high)),
    low: Math.min(...cs.map((c) => c.low)),
    close: last.close,
    base: data.warmup?.at(-1)?.close ?? first.open,
  };
}

function StatChip({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-baseline gap-1 rounded-full bg-cream-deep/70 px-2.5 py-1.5 text-[13px]">
      <span className="text-slate-strong">{label}</span>
      <span className="tabular font-semibold text-ink">{formatNumber(value)}</span>
    </span>
  );
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
        "inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[13px] font-semibold transition",
        checked
          ? "border-transparent bg-cream-deep/70 text-ink"
          : "border-dashed border-slate/40 text-slate-strong hover:text-ink",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "relative h-3.5 w-6 shrink-0 rounded-full transition-colors",
          checked ? "bg-mint-deep" : "bg-slate/25",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-2.5 rounded-full bg-surface shadow-soft transition-[left]",
            checked ? "left-3" : "left-0.5",
          )}
        />
      </span>
      {label}
    </button>
  );
}

function LevelLegend() {
  return (
    <span className="inline-flex items-center gap-3" aria-hidden>
      <span className="inline-flex items-center gap-1">
        <span className="w-4 border-t-2 border-dashed border-resistance" /> แนวต้าน
      </span>
      <span className="inline-flex items-center gap-1">
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
  const ohlc = data ? ohlcFor(data, hover) : null;
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
        intraday={["1d", "1w"].includes(range)}
        height={CHART_HEIGHT}
        onHover={setHover}
      />
    );
  }

  const last = data?.candles.at(-1);
  return (
    <Card className="space-y-3 px-3 pb-3">
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
        <div className="flex flex-wrap items-center gap-1.5">
          <StatChip label="เปิด" value={ohlc.open} />
          <StatChip label="สูง" value={ohlc.high} />
          <StatChip label="ต่ำ" value={ohlc.low} />
          <StatChip label="ปิด" value={ohlc.close} />
          <PriceChange
            change={ohlc.close - ohlc.base}
            changePercent={ohlc.base ? ((ohlc.close - ohlc.base) / ohlc.base) * 100 : null}
            variant="pill"
            className="ml-auto px-2.5 py-1.5 text-[13px]"
          />
        </div>
      )}

      {/* One row like the reference; scrolls sideways on very narrow phones. */}
      <div className="flex gap-1 overflow-x-auto [scrollbar-width:none]">
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

      {prefs.showEma && (
        <div className="flex items-center gap-2">
          <ul className="flex min-w-0 flex-1 flex-wrap gap-x-3 gap-y-1 px-1 text-xs">
            {emaLines.map((l) => {
              const v = l.values[legendIndex];
              return (
                <li key={l.slot} className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="h-[3px] w-3.5 rounded-full"
                    style={{ backgroundColor: `var(--color-${EMA_COLOR_TOKENS[l.slot]!.name})` }}
                  />
                  <span className="font-semibold text-slate-strong">EMA{l.period}</span>
                  <span className="tabular font-semibold text-ink">
                    {v === null || v === undefined ? "—" : formatNumber(v)}
                  </span>
                </li>
              );
            })}
            {prefs.ema.every((s) => !s.enabled) && (
              <li className="text-slate">ปิดเส้น EMA ไว้ทั้งหมด</li>
            )}
          </ul>
          <button
            ref={gearRef}
            type="button"
            aria-label="ตั้งค่าเส้น EMA"
            title="ตั้งค่าเส้น EMA"
            onClick={() => setSettingsOpen(true)}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-slate-strong transition hover:bg-cream-deep hover:text-ink"
          >
            <SlidersHorizontal aria-hidden className="size-4" />
          </button>
        </div>
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
        <div className="space-y-1 px-1 text-[11px] text-slate">
          {prefs.showEma && short.length > 0 && (
            <p>
              ข้อมูลย้อนหลังไม่พอคำนวณ {short.map((l) => `EMA${l.period}`).join(", ")} ในช่วงนี้
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <span>
              {candleLabel(data.interval)} · {RANGE_SPANS[range]} · แท่งล่าสุด{" "}
              {formatBarTime(last.time, data.interval)}
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
    </Card>
  );
}
