"use client";

import {
  CandlestickSeries,
  ColorType,
  createChart,
  HistogramSeries,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useMemo, useRef } from "react";

import { toChartTime } from "@/lib/exchange-time";
import { formatMarketDate, formatNumber } from "@/lib/format";
import type { LabeledLevel } from "@/lib/levels";
import type { CandleSeries } from "@/types/api";

interface CandlestickChartProps {
  series: CandleSeries;
  levels?: LabeledLevel[];
  /** Intraday ranges show times on the axis. */
  intraday: boolean;
  height?: number;
}

/** Reads a design token so the canvas uses the same palette as the CSS. */
function token(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return (
    getComputedStyle(document.documentElement).getPropertyValue(`--color-${name}`).trim() ||
    fallback
  );
}

function withAlpha(hex: string, alpha: string): string {
  return /^#[0-9a-f]{6}$/i.test(hex) ? `${hex}${alpha}` : hex;
}

/** Converts candles to chart points with strictly increasing times. */
function toPoints(series: CandleSeries) {
  const candles: { time: UTCTimestamp; open: number; high: number; low: number; close: number }[] =
    [];
  const volume: { time: UTCTimestamp; value: number; up: boolean }[] = [];
  let last = -Infinity;
  for (const c of series.candles) {
    const time = toChartTime(c.time, series.exchangeTimezone) as UTCTimestamp;
    if (!(time > last)) continue;
    last = time;
    candles.push({ time, open: c.open, high: c.high, low: c.low, close: c.close });
    if (c.volume !== null) volume.push({ time, value: c.volume, up: c.close >= c.open });
  }
  return { candles, volume };
}

export function CandlestickChart({
  series,
  levels = [],
  intraday,
  height = 280,
}: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);

  const points = useMemo(() => toPoints(series), [series]);

  // Create the chart once.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: token("slate", "#6b7280"),
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        fontSize: 11,
      },
      grid: { vertLines: { visible: false }, horzLines: { color: token("line", "#efe7da") } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.24 } },
      timeScale: {
        borderVisible: false,
        secondsVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      crosshair: {
        horzLine: { labelBackgroundColor: token("ink", "#24403d") },
        vertLine: { labelBackgroundColor: token("ink", "#24403d") },
      },
      // Let vertical swipes scroll the page on touch devices.
      handleScroll: { vertTouchDrag: false },
    });
    const up = token("up", "#187a50");
    const down = token("down", "#c2374f");
    candleRef.current = chart.addSeries(CandlestickSeries, {
      upColor: up,
      downColor: down,
      wickUpColor: up,
      wickDownColor: down,
      borderVisible: false,
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });
    volumeRef.current = chart.addSeries(HistogramSeries, {
      priceScaleId: "volume",
      priceFormat: { type: "volume" },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chartRef.current = chart;
    return () => {
      chart.remove();
      chartRef.current = candleRef.current = volumeRef.current = null;
      linesRef.current = [];
    };
  }, []);

  useEffect(() => {
    chartRef.current?.applyOptions({ timeScale: { timeVisible: intraday } });
  }, [intraday]);

  useEffect(() => {
    const candle = candleRef.current;
    const volume = volumeRef.current;
    if (!candle || !volume) return;
    const up = withAlpha(token("up", "#187a50"), "40");
    const down = withAlpha(token("down", "#c2374f"), "40");
    candle.setData(points.candles);
    volume.setData(
      points.volume.map((v) => ({ time: v.time, value: v.value, color: v.up ? up : down })),
    );
    chartRef.current?.timeScale().fitContent();
  }, [points]);

  useEffect(() => {
    const candle = candleRef.current;
    if (!candle) return;
    for (const line of linesRef.current) candle.removePriceLine(line);
    linesRef.current = levels.map((l) =>
      candle.createPriceLine({
        price: l.price,
        color: token(l.type, l.type === "support" ? "#2f9c6f" : "#e0627a"),
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: l.label,
      }),
    );
  }, [levels]);

  const first = series.candles[0];
  const last = series.candles[series.candles.length - 1];
  const summary = last
    ? `${series.symbol} candlestick chart, ${series.candles.length} bars from ${formatMarketDate(first?.time)} to ${formatMarketDate(last.time)}, last close ${formatNumber(last.close)}.`
    : `${series.symbol} chart has no data.`;

  return (
    <div ref={containerRef} role="img" aria-label={summary} style={{ height }} className="w-full" />
  );
}
