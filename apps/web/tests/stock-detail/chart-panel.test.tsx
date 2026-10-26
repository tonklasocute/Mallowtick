import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CHART_PREFS_KEY,
  DEFAULT_CHART_PREFS,
  parseChartPrefs,
} from "@/features/stock-detail/chart-prefs";
import { ChartPanel } from "@/features/stock-detail/chart-panel";
import type { useCandles } from "@/services/api/queries";
import type { Candle, CandleSeries } from "@/types/api";

// The canvas chart cannot render in jsdom; record what it is given instead.
const chartProps = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }));
vi.mock("@/components/charts/candlestick-chart", () => ({
  token: (_name: string, fallback: string) => fallback,
  CandlestickChart: (props: Record<string, unknown>) => {
    chartProps.current = props;
    return <div data-testid="chart" />;
  },
}));

afterEach(() => window.localStorage.clear());

function candle(i: number, close: number): Candle {
  const day = new Date(Date.UTC(2026, 0, 1 + i, 14, 30)).toISOString();
  return { time: day, open: close - 1, high: close + 2, low: close - 3, close, volume: 1000 };
}

function series(closes: number[], warmupCloses: number[] = []): CandleSeries {
  const all = [...warmupCloses, ...closes].map((c, i) => candle(i, c));
  return {
    symbol: "AAPL",
    interval: "1day",
    exchangeTimezone: "America/New_York",
    warmup: all.slice(0, warmupCloses.length),
    candles: all.slice(warmupCloses.length),
    range: "1m",
    freshness: {
      provider: "twelvedata",
      latency: "unknown",
      asOf: null,
      fetchedAt: "2026-01-30T00:00:00Z",
      stale: false,
    },
  };
}

function renderPanel(data: CandleSeries) {
  const query = {
    data,
    error: null,
    isPending: false,
    isPlaceholderData: false,
    isFetching: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useCandles>;
  return render(<ChartPanel range="1m" onRangeChange={vi.fn()} candles={query} levels={[]} />);
}

describe("parseChartPrefs", () => {
  it("defaults to EMA 20/50/100/200 with every layer on", () => {
    expect(parseChartPrefs(null)).toEqual(DEFAULT_CHART_PREFS);
    expect(DEFAULT_CHART_PREFS.ema.map((e) => e.period)).toEqual([20, 50, 100, 200]);
  });

  it("keeps valid stored values and replaces invalid ones with defaults", () => {
    const prefs = parseChartPrefs(
      JSON.stringify({
        ema: [{ period: 9, enabled: false }, { period: 1 }, { period: 301 }, "x"],
        showVolume: false,
        showLevels: "yes",
      }),
    );
    expect(prefs.ema).toEqual([
      { period: 9, enabled: false },
      { period: 50, enabled: true },
      { period: 100, enabled: true },
      { period: 200, enabled: true },
    ]);
    expect(prefs.showVolume).toBe(false);
    expect(prefs.showLevels).toBe(true);
  });

  it("survives corrupted storage", () => {
    expect(parseChartPrefs("{not json")).toEqual(DEFAULT_CHART_PREFS);
  });
});

describe("ChartPanel", () => {
  it("summarises the range against the close before it", () => {
    renderPanel(series([110, 120, 100, 105], [100]));
    expect(screen.getByText("เปิด").nextSibling).toHaveTextContent("109.00");
    expect(screen.getByText("สูง").nextSibling).toHaveTextContent("122.00");
    expect(screen.getByText("ต่ำ").nextSibling).toHaveTextContent("97.00");
    expect(screen.getByText("ปิด").nextSibling).toHaveTextContent("105.00");
    expect(screen.getByText("+5.00 (+5.00%)")).toBeInTheDocument();
  });

  it("computes EMA from warm-up bars and passes only visible values to the chart", () => {
    const flat = Array(30).fill(50);
    window.localStorage.setItem(
      CHART_PREFS_KEY,
      JSON.stringify({ ...DEFAULT_CHART_PREFS, ema: [{ period: 20, enabled: true }] }),
    );
    renderPanel(series([50, 50], flat));
    const lines = chartProps.current?.lines as { values: (number | null)[] }[];
    expect(lines[0]!.values).toEqual([50, 50]);
    expect(screen.getByText("EMA20").nextSibling).toHaveTextContent("50.00");
  });

  it("says when there is not enough history for a line", () => {
    renderPanel(series([10, 11, 12]));
    expect(screen.getByText(/ข้อมูลย้อนหลังไม่พอคำนวณ EMA20, EMA50, EMA100, EMA200/)).toBeVisible();
    expect(screen.getByText("EMA200").nextSibling).toHaveTextContent("—");
  });

  it("remembers layer toggles on this device", async () => {
    renderPanel(series([10, 11]));
    await userEvent.click(screen.getByRole("switch", { name: "วอลุ่ม" }));
    expect(screen.getByRole("switch", { name: "วอลุ่ม" })).toHaveAttribute("aria-checked", "false");
    expect(JSON.parse(window.localStorage.getItem(CHART_PREFS_KEY)!).showVolume).toBe(false);
    expect(chartProps.current?.showVolume).toBe(false);
  });

  it("edits EMA periods in the settings sheet", async () => {
    renderPanel(series([10, 11]));
    await userEvent.click(screen.getByRole("button", { name: "ตั้งค่าเส้น EMA" }));
    const dialog = screen.getByRole("dialog", { name: "ตั้งค่าเส้น EMA" });
    const first = within(dialog).getByLabelText("เส้นที่ 1");
    expect(first).toHaveFocus();

    await userEvent.clear(first);
    await userEvent.type(first, "1");
    expect(within(dialog).getByRole("button", { name: "บันทึก" })).toBeDisabled();

    await userEvent.type(first, "2");
    await userEvent.click(within(dialog).getByRole("button", { name: "บันทึก" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("EMA12")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ตั้งค่าเส้น EMA" })).toHaveFocus();
  });

  it("closes the settings sheet with Escape without saving", async () => {
    renderPanel(series([10, 11]));
    await userEvent.click(screen.getByRole("button", { name: "ตั้งค่าเส้น EMA" }));
    await userEvent.type(screen.getByLabelText("เส้นที่ 2"), "0");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("EMA50")).toBeInTheDocument();
  });
});
