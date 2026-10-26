"use client";

import {
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
import { formatMarketDate, formatNumber } from "@/lib/format";
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
  /** Intraday ranges show times on the axis. */
  intraday: boolean;
  height?: number;
  /** Index into `series.candles` under the crosshair, or null when it leaves the chart. */
  onHover?: (index: number | null) => void;
}

/** Width of the price-pill column on the right of the plot. */
const PILL_COLUMN = 64;
const PILL_HEIGHT = 20;
const PILL_GAP = 3;

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
  intraday,
  height = 300,
  onHover,
}: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<"Line">[]>([]);
  const priceLinesRef = useRef<IPriceLine[]>([]);

  const [pills, setPills] = useState<Pill[]>([]);
  const [lastDot, setLastDot] = useState<{ x: number; y: number } | null>(null);

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
    const candle = candleRef.current;
    const el = containerRef.current;
    if (!chart || !candle || !el) return true;
    const last = points.candles.at(-1);
    if (last && candle.priceToCoordinate(last.close) === null) return false;
    const plotHeight = el.clientHeight - chart.timeScale().height();
    const inPlot = (y: number | null): y is number => y !== null && y >= 0 && y <= plotHeight;

    const next: Pill[] = [];
    for (const l of levels) {
      const y = candle.priceToCoordinate(l.price);
      if (inPlot(y)) next.push({ key: l.label, kind: l.type, price: l.price, y });
    }
    if (last) {
      const y = candle.priceToCoordinate(last.close);
      const x = chart.timeScale().timeToCoordinate(last.time);
      if (inPlot(y)) next.push({ key: "last", kind: "last", price: last.close, y });
      setLastDot(inPlot(y) && x !== null ? { x, y } : null);
    } else {
      setLastDot(null);
    }
    setPills(spread(next, plotHeight));
    return true;
  }, [levels, points]);

  // Chart event handlers are registered once; they read the latest values through refs.
  const layoutRef = useRef(layoutOverlay);
  const indexByTimeRef = useRef(indexByTime);
  const onHoverRef = useRef(onHover);
  useLayoutEffect(() => {
    layoutRef.current = layoutOverlay;
    indexByTimeRef.current = indexByTime;
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
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        fontSize: 11,
        // No logo on the chart. The licence's attribution notice and link to
        // tradingview.com are on the More screen (features/more/more-screen.tsx):
        //   TradingView Lightweight Charts™
        //   Copyright (с) 2025 TradingView, Inc. https://www.tradingview.com/
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: token("line", "#efe7da"), style: LineStyle.Dotted },
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
    const up = token("candle-up", "#2ba47a");
    const down = token("candle-down", "#ee6a87");
    candleRef.current = chart.addSeries(CandlestickSeries, {
      upColor: up,
      downColor: down,
      wickUpColor: up,
      wickDownColor: down,
      borderVisible: false,
      lastValueVisible: false,
      priceLineColor: token("slate", "#6b7280"),
      priceLineStyle: LineStyle.Dotted,
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });
    volumeRef.current = chart.addSeries(HistogramSeries, {
      priceScaleId: "volume",
      priceFormat: { type: "volume" },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });

    const onMove = (p: MouseEventParams<Time>) => {
      const index = p.time === undefined ? undefined : indexByTimeRef.current.get(p.time as number);
      onHoverRef.current?.(index ?? null);
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
      chartRef.current = candleRef.current = volumeRef.current = null;
      lineSeriesRef.current = [];
      priceLinesRef.current = [];
    };
  }, [scheduleLayout]);

  useEffect(() => {
    chartRef.current?.applyOptions({ timeScale: { timeVisible: intraday } });
  }, [intraday]);

  useEffect(() => {
    const candle = candleRef.current;
    const volume = volumeRef.current;
    if (!candle || !volume) return;
    const up = withAlpha(token("candle-up", "#2ba47a"), "40");
    const down = withAlpha(token("candle-down", "#ee6a87"), "40");
    candle.setData(points.candles);
    volume.setData(
      points.volume.map((v) => ({ time: v.time, value: v.value, color: v.up ? up : down })),
    );
    chartRef.current?.timeScale().fitContent();
  }, [points]);

  useEffect(() => {
    volumeRef.current?.applyOptions({ visible: showVolume });
    candleRef.current
      ?.priceScale()
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
  }, [lines, points]);

  useEffect(() => {
    const candle = candleRef.current;
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
  }, [levels, scheduleLayout]);

  useEffect(() => {
    scheduleLayout();
  }, [points, lines, scheduleLayout]);

  const first = series.candles[0];
  const last = series.candles[series.candles.length - 1];
  const summary = last
    ? `กราฟแท่งเทียน ${series.symbol} จำนวน ${series.candles.length} แท่ง ตั้งแต่ ${formatMarketDate(first?.time)} ถึง ${formatMarketDate(last.time)} ราคาปิดล่าสุด ${formatNumber(last.close)}`
    : `กราฟ ${series.symbol} ไม่มีข้อมูล`;

  return (
    <div className="flex w-full" style={{ height }}>
      <div className="relative min-w-0 flex-1">
        <div ref={containerRef} role="img" aria-label={summary} className="h-full w-full" />
        {lastDot && (
          <span
            aria-hidden
            className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-[2.5px] border-ink bg-surface shadow-soft"
            style={{ left: lastDot.x, top: lastDot.y }}
          />
        )}
      </div>
      <div aria-hidden className="relative shrink-0" style={{ width: PILL_COLUMN }}>
        {pills.map((p) => (
          <span
            key={p.key}
            className={cn(
              "tabular absolute right-0 left-1.5 flex items-center justify-center rounded-full text-[11px] font-semibold",
              PILL_STYLE[p.kind],
            )}
            style={{ top: p.y - PILL_HEIGHT / 2, height: PILL_HEIGHT }}
          >
            {formatNumber(p.price)}
          </span>
        ))}
      </div>
    </div>
  );
}
