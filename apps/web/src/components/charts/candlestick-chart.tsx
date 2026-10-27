"use client";

import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  createChart,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { toChartTime } from "@/lib/exchange-time";
import {
  formatBarTime,
  formatCompact,
  formatMarketDate,
  formatNumber,
  formatSignedPercent,
} from "@/lib/format";
import type { LabeledLevel } from "@/lib/levels";
import type { CandleSeries } from "@/types/api";

/** An indicator line aligned with `series.candles`; null where it has no value yet. */
export interface ChartLine {
  key: string;
  color: string;
  values: (number | null)[];
}

interface CandlestickChartProps {
  series: CandleSeries;
  lines?: ChartLine[];
  levels?: LabeledLevel[];
  showVolume?: boolean;
  /** Candles, or a close line with a soft fill for ranges too long for readable candles. */
  kind?: "candles" | "line";
  /** Intraday ranges show times on the axis. */
  intraday: boolean;
  height?: number;
  /** Index into `series.candles` under the crosshair, or null when it leaves the chart. */
  onHover?: (index: number | null) => void;
}

const PILL_HEIGHT = 20;
const PILL_GAP = 3;
/** Price labels closer than this to a pill are hidden. */
const TICK_CLEARANCE = 15;
const TOOLTIP_WIDTH = 168;
/** Share of the pane the volume bars sit below (the volume scale's top margin). */
const VOLUME_TOP = 0.84;

/** Reads a design token so the canvas uses the same palette as the CSS. */
export function token(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return (
    getComputedStyle(document.documentElement).getPropertyValue(`--color-${name}`).trim() ||
    fallback
  );
}

function withAlpha(hex: string, alpha: string): string {
  return /^#[0-9a-f]{6}$/i.test(hex) ? `${hex}${alpha}` : hex;
}

/** Converts candles to chart points with strictly increasing times, keeping each candle's index. */
function toPoints(series: CandleSeries) {
  const candles: {
    time: UTCTimestamp;
    open: number;
    high: number;
    low: number;
    close: number;
  }[] = [];
  const volume: { time: UTCTimestamp; value: number; up: boolean }[] = [];
  const indexes: number[] = [];
  let last = -Infinity;
  series.candles.forEach((c, i) => {
    const time = toChartTime(c.time, series.exchangeTimezone) as UTCTimestamp;
    if (!(time > last)) return;
    last = time;
    candles.push({ time, open: c.open, high: c.high, low: c.low, close: c.close });
    indexes.push(i);
    if (c.volume !== null) volume.push({ time, value: c.volume, up: c.close >= c.open });
  });
  return { candles, volume, indexes };
}

type PillKind = "resistance" | "support" | "last";

interface Pill {
  key: string;
  kind: PillKind;
  label: string;
  price: number;
  y: number;
}

/** Spreads pills vertically so none overlap, keeping them inside the plot. */
function spread(pills: Pill[], plotHeight: number): Pill[] {
  const sorted = [...pills].sort((a, b) => a.y - b.y);
  const step = PILL_HEIGHT + PILL_GAP;
  for (let i = 1; i < sorted.length; i++) {
    sorted[i]!.y = Math.max(sorted[i]!.y, sorted[i - 1]!.y + step);
  }
  const overflow = (sorted.at(-1)?.y ?? 0) + PILL_HEIGHT / 2 - plotHeight;
  if (overflow > 0) {
    for (let i = sorted.length - 1; i >= 0; i--) {
      const limit = i === sorted.length - 1 ? sorted[i]!.y - overflow : sorted[i + 1]!.y - step;
      sorted[i]!.y = Math.min(sorted[i]!.y, limit);
    }
  }
  return sorted;
}

type MainSeries =
  | { kind: "candles"; series: ISeriesApi<"Candlestick"> }
  | { kind: "line"; series: ISeriesApi<"Area"> };

interface Tick {
  price: number;
  y: number;
}

/** Round-number prices between low and high, about five of them, for the grid. */
function niceTicks(low: number, high: number): number[] {
  const raw = (high - low) / 5;
  if (!(raw > 0) || !Number.isFinite(raw)) return [];
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const ticks: number[] = [];
  for (let p = Math.ceil(low / step) * step; p <= high; p += step) ticks.push(p);
  return ticks;
}

/** "R2" → "แนวต้าน 2" on wider cards, "R2" on phones. */
function LevelName({ kind, label }: { kind: PillKind; label: string }) {
  if (kind === "last") return null;
  return (
    <>
      <span className="sm:hidden">{label}</span>
      <span className="hidden sm:inline">
        {kind === "resistance" ? "แนวต้าน" : "แนวรับ"} {label.slice(1)}
      </span>
    </>
  );
}

const PILL_STYLE: Record<PillKind, string> = {
  resistance: "bg-accent-soft text-down",
  support: "bg-mint-soft text-mint-deep",
  last: "bg-ink text-surface",
};

export function CandlestickChart({
  series,
  lines = [],
  levels = [],
  showVolume = true,
  kind = "candles",
  intraday,
  height = 300,
  onHover,
}: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainRef = useRef<MainSeries | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<"Line">[]>([]);
  const priceLinesRef = useRef<IPriceLine[]>([]);

  const [pills, setPills] = useState<Pill[]>([]);
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [lastDot, setLastDot] = useState<{ x: number; y: number } | null>(null);
  const [hover, setHover] = useState<{
    index: number;
    x: number;
    y: number;
    /** Tooltip position: right of the crosshair, or left of it near the right edge. */
    left: number;
  } | null>(null);

  const points = useMemo(() => toPoints(series), [series]);
  const indexByTime = useMemo(
    () => new Map(points.candles.map((c, i) => [c.time as number, points.indexes[i]!])),
    [points],
  );

  /**
   * Places the price pills and the last-price dot from the chart's current
   * scale. Returns false while the chart has data but has not laid it out yet.
   */
  const layoutOverlay = useCallback((): boolean => {
    const chart = chartRef.current;
    const candle = mainRef.current?.series;
    const el = containerRef.current;
    if (!chart || !candle || !el) return true;
    const last = points.candles.at(-1);
    if (last && candle.priceToCoordinate(last.close) === null) return false;
    const plotHeight = el.clientHeight - chart.timeScale().height();
    const inPlot = (y: number | null): y is number => y !== null && y >= 0 && y <= plotHeight;

    const next: Pill[] = [];
    for (const l of levels) {
      const y = candle.priceToCoordinate(l.price);
      if (inPlot(y)) next.push({ key: l.label, kind: l.type, label: l.label, price: l.price, y });
    }
    if (last) {
      const y = candle.priceToCoordinate(last.close);
      const x = chart.timeScale().timeToCoordinate(last.time);
      if (inPlot(y)) next.push({ key: "last", kind: "last", label: "", price: last.close, y });
      setLastDot(inPlot(y) && x !== null ? { x, y } : null);
    } else {
      setLastDot(null);
    }
    const placed = spread(next, plotHeight);
    setPills(placed);

    // Grid over the price area only, not the volume bars.
    const priceBottom = showVolume ? plotHeight * VOLUME_TOP : plotHeight;
    const high = candle.coordinateToPrice(0);
    const low = candle.coordinateToPrice(priceBottom);
    setTicks(
      high === null || low === null
        ? []
        : niceTicks(low, high).flatMap((price) => {
            const y = candle.priceToCoordinate(price);
            return y !== null && y > 8 && y < priceBottom ? [{ price, y }] : [];
          }),
    );
    return true;
  }, [levels, points, showVolume]);

  // Chart event handlers are registered once; they read the latest values through refs.
  const layoutRef = useRef(layoutOverlay);
  const indexByTimeRef = useRef(indexByTime);
  const seriesRef = useRef(series);
  const onHoverRef = useRef(onHover);
  useLayoutEffect(() => {
    layoutRef.current = layoutOverlay;
    indexByTimeRef.current = indexByTime;
    seriesRef.current = series;
    onHoverRef.current = onHover;
  });

  // The chart lays itself out on a later animation frame (and only once it has a
  // size), so retry each frame until it has, giving up after about a third of a second.
  const frameRef = useRef(0);
  const scheduleLayout = useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    let attempts = 20;
    const tick = () => {
      if (!layoutRef.current() && --attempts > 0) frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
  }, []);

  // Create the chart once.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ink = token("ink", "#24403d");
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: token("slate", "#6b7280"),
        // The app font (Nunito), resolved from the next/font variables on <html>.
        fontFamily: getComputedStyle(el).fontFamily,
        fontSize: 11,
        // No logo on the chart. The licence's attribution notice and link to
        // tradingview.com are on the More screen (features/more/more-screen.tsx):
        //   TradingView Lightweight Charts™
        //   Copyright (с) 2025 TradingView, Inc. https://www.tradingview.com/
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: false },
        // Drawn as an overlay at round prices, labelled in the pill column.
        horzLines: { visible: false },
      },
      // Key prices are shown as pills beside the plot instead of a price axis.
      rightPriceScale: { visible: false },
      timeScale: {
        borderVisible: false,
        secondsVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
        // Keep showing the whole range when the card is resized (rotation, desktop window).
        lockVisibleTimeRangeOnResize: true,
      },
      crosshair: {
        horzLine: { visible: false, labelVisible: false },
        vertLine: {
          color: withAlpha(ink, "55"),
          style: LineStyle.Dotted,
          labelBackgroundColor: ink,
        },
      },
      // Let vertical swipes scroll the page on touch devices.
      handleScroll: { vertTouchDrag: false },
    });
    volumeRef.current = chart.addSeries(HistogramSeries, {
      priceScaleId: "volume",
      priceFormat: { type: "volume" },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });

    const onMove = (p: MouseEventParams<Time>) => {
      const index =
        p.time === undefined || !p.point ? undefined : indexByTimeRef.current.get(p.time as number);
      onHoverRef.current?.(index ?? null);
      const main = mainRef.current?.series;
      const x = p.time === undefined ? null : chart.timeScale().timeToCoordinate(p.time);
      const close = index === undefined ? undefined : seriesRef.current.candles[index]?.close;
      const y = close === undefined ? null : (main?.priceToCoordinate(close) ?? null);
      if (index === undefined || x === null || y === null) {
        setHover(null);
        return;
      }
      const right = x + 16 + TOOLTIP_WIDTH <= el.clientWidth;
      setHover({ index, x, y, left: right ? x + 16 : Math.max(0, x - 16 - TOOLTIP_WIDTH) });
    };
    chart.subscribeCrosshairMove(onMove);
    chart.timeScale().subscribeVisibleLogicalRangeChange(scheduleLayout);
    chart.timeScale().subscribeSizeChange(scheduleLayout);
    const resize = new ResizeObserver(scheduleLayout);
    resize.observe(el);

    chartRef.current = chart;
    return () => {
      resize.disconnect();
      cancelAnimationFrame(frameRef.current);
      chart.unsubscribeCrosshairMove(onMove);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(scheduleLayout);
      chart.timeScale().unsubscribeSizeChange(scheduleLayout);
      chart.remove();
      chartRef.current = volumeRef.current = null;
      lineSeriesRef.current = [];
      priceLinesRef.current = [];
    };
  }, [scheduleLayout]);

  useEffect(() => {
    chartRef.current?.applyOptions({ timeScale: { timeVisible: intraday } });
  }, [intraday]);

  // Created after the volume bars so it draws over them; the EMA lines are re-added after it.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const common = {
      lastValueVisible: false,
      priceLineColor: withAlpha(token("ink", "#24403d"), "b3"),
      priceLineStyle: LineStyle.SparseDotted,
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    } as const;
    if (kind === "line") {
      mainRef.current = {
        kind,
        series: chart.addSeries(AreaSeries, {
          ...common,
          lineWidth: 2,
          crosshairMarkerVisible: false,
        }),
      };
    } else {
      const up = token("candle-up", "#2ba47a");
      const down = token("candle-down", "#ee6a87");
      mainRef.current = {
        kind,
        series: chart.addSeries(CandlestickSeries, {
          ...common,
          upColor: up,
          downColor: down,
          wickUpColor: up,
          wickDownColor: down,
          borderVisible: false,
        }),
      };
    }
    const created = mainRef.current.series;
    return () => {
      // On unmount the chart (and this series with it) is already gone.
      chartRef.current?.removeSeries(created);
      mainRef.current = null;
      // Its price lines went with it.
      priceLinesRef.current = [];
    };
  }, [kind]);

  useEffect(() => {
    const main = mainRef.current;
    const volume = volumeRef.current;
    if (!main || !volume) return;
    const up = withAlpha(token("candle-up", "#2ba47a"), "4d");
    const down = withAlpha(token("candle-down", "#ee6a87"), "4d");
    if (main.kind === "line") {
      const first = points.candles[0];
      const last = points.candles.at(-1);
      const color =
        first && last && last.close < first.open
          ? token("candle-down", "#ee6a87")
          : token("candle-up", "#2ba47a");
      main.series.applyOptions({
        lineColor: color,
        topColor: withAlpha(color, "42"),
        bottomColor: withAlpha(color, "00"),
      });
      main.series.setData(points.candles.map((c) => ({ time: c.time, value: c.close })));
    } else {
      main.series.setData(points.candles);
    }
    volume.setData(
      points.volume.map((v) => ({ time: v.time, value: v.value, color: v.up ? up : down })),
    );
    chartRef.current?.timeScale().fitContent();
  }, [points, kind]);

  useEffect(() => {
    volumeRef.current?.applyOptions({ visible: showVolume });
    chartRef.current
      ?.priceScale("right")
      .applyOptions({ scaleMargins: { top: 0.1, bottom: showVolume ? 0.22 : 0.08 } });
    scheduleLayout();
  }, [showVolume, scheduleLayout]);

  // Indicator lines never drive the price scale, so a far-away EMA cannot squash the candles.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const s of lineSeriesRef.current) chart.removeSeries(s);
    lineSeriesRef.current = lines.map((line) => {
      const s = chart.addSeries(LineSeries, {
        color: line.color,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        autoscaleInfoProvider: () => null,
      });
      s.setData(
        points.candles.flatMap((c, i) => {
          const v = line.values[points.indexes[i]!];
          return v === null || v === undefined ? [] : [{ time: c.time, value: v }];
        }),
      );
      return s;
    });
  }, [lines, points, kind]);

  useEffect(() => {
    const candle = mainRef.current?.series;
    if (!candle) return;
    for (const line of priceLinesRef.current) candle.removePriceLine(line);
    priceLinesRef.current = levels.map((l) =>
      candle.createPriceLine({
        price: l.price,
        color: token(l.type, l.type === "support" ? "#2f9c6f" : "#e0627a"),
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: false,
      }),
    );
    scheduleLayout();
  }, [levels, kind, scheduleLayout]);

  useEffect(() => {
    scheduleLayout();
  }, [points, lines, scheduleLayout]);

  const first = series.candles[0];
  const last = series.candles[series.candles.length - 1];
  const summary = last
    ? `${kind === "line" ? "กราฟเส้นราคาปิด" : "กราฟแท่งเทียน"} ${series.symbol} จำนวน ${series.candles.length} แท่ง ตั้งแต่ ${formatMarketDate(first?.time)} ถึง ${formatMarketDate(last.time)} ราคาปิดล่าสุด ${formatNumber(last.close)}`
    : `กราฟ ${series.symbol} ไม่มีข้อมูล`;

  const bar = hover ? series.candles[hover.index] : undefined;
  const barBase = hover
    ? hover.index > 0
      ? series.candles[hover.index - 1]?.close
      : series.warmup?.at(-1)?.close
    : undefined;
  const barChange = bar && barBase ? ((bar.close - barBase) / barBase) * 100 : null;
  const tickLabels = ticks.filter((t) => pills.every((p) => Math.abs(p.y - t.y) >= TICK_CLEARANCE));

  return (
    <div className="flex w-full" style={{ height }}>
      <div className="relative min-w-0 flex-1">
        <svg aria-hidden className="pointer-events-none absolute inset-0 size-full">
          {ticks.map((t) => (
            <line
              key={t.price}
              x1="0"
              x2="100%"
              y1={t.y}
              y2={t.y}
              className="stroke-peach"
              strokeWidth={1.2}
              strokeDasharray="2 5"
              strokeLinecap="round"
            />
          ))}
        </svg>
        {/* Positioned after the grid so the candles draw over it. */}
        <div
          ref={containerRef}
          role="img"
          aria-label={summary}
          className="relative h-full w-full"
        />
        {lastDot && (
          <span
            aria-hidden
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2"
            style={{ left: lastDot.x, top: lastDot.y }}
          >
            <span className="absolute inset-0 animate-pulse-dot rounded-full bg-ink" />
            <span className="relative block size-3 rounded-full border-2 border-surface bg-ink shadow-soft" />
          </span>
        )}
        {hover && bar && (
          <div aria-hidden className="pointer-events-none absolute inset-0 z-10">
            <span
              className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink bg-surface"
              style={{ left: hover.x, top: hover.y }}
            />
            <div
              className="absolute top-2 rounded-2xl bg-ink px-3.5 py-3 text-surface shadow-float"
              style={{ left: hover.left, width: TOOLTIP_WIDTH }}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-display text-[11.5px] leading-tight font-extrabold">
                  {intraday ? formatBarTime(bar.time, series.interval) : formatMarketDate(bar.time)}
                </span>
                {barChange !== null && (
                  <span
                    className={cn(
                      "tabular shrink-0 rounded-full px-1.5 py-0.5 font-display text-[10px] font-black text-white",
                      barChange < 0 ? "bg-down" : "bg-up",
                    )}
                  >
                    {formatSignedPercent(barChange)}
                  </span>
                )}
              </div>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[10.5px]">
                {(
                  [
                    ["เปิด", formatNumber(bar.open)],
                    ["สูง", formatNumber(bar.high)],
                    ["ต่ำ", formatNumber(bar.low)],
                    ["ปิด", formatNumber(bar.close)],
                    ["วอลุ่ม", formatCompact(bar.volume)],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-surface/70">{k}</dt>
                    <dd className="tabular text-right font-display font-extrabold">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        )}
      </div>
      <div aria-hidden className="relative w-[76px] shrink-0 sm:w-[112px]">
        {tickLabels.map((t) => (
          <span
            key={t.price}
            className="tabular absolute right-0 left-1.5 -translate-y-1/2 text-center font-display text-[10.5px] font-bold text-slate"
            style={{ top: t.y }}
          >
            {formatNumber(t.price, t.price >= 100 ? 0 : 2)}
          </span>
        ))}
        {pills.map((p) => (
          <span
            key={p.key}
            className={cn(
              "tabular absolute right-0 left-1.5 flex items-center justify-center gap-1.5 rounded-full text-[11px] font-semibold whitespace-nowrap",
              PILL_STYLE[p.kind],
            )}
            style={{ top: p.y - PILL_HEIGHT / 2, height: PILL_HEIGHT }}
          >
            <LevelName kind={p.kind} label={p.label} />
            {formatNumber(p.price)}
          </span>
        ))}
      </div>
    </div>
  );
}
