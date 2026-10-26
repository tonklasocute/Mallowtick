"use client";

import { useCallback, useSyncExternalStore } from "react";

import { EMA_MAX_PERIOD, EMA_MIN_PERIOD } from "@/lib/ema";

export interface EmaLineSetting {
  period: number;
  enabled: boolean;
}

/** How the price chart is drawn. Saved on this device only. */
export interface ChartPrefs {
  /** Four EMA lines; each slot keeps its colour. */
  ema: EmaLineSetting[];
  showEma: boolean;
  showLevels: boolean;
  showVolume: boolean;
}

export const DEFAULT_EMA_PERIODS = [20, 50, 100, 200] as const;

export const DEFAULT_CHART_PREFS: ChartPrefs = {
  ema: DEFAULT_EMA_PERIODS.map((period) => ({ period, enabled: true })),
  showEma: true,
  showLevels: true,
  showVolume: true,
};

export const CHART_PREFS_KEY = "mallowtick.chart-prefs.v1";

export function isValidPeriod(n: unknown): n is number {
  return Number.isInteger(n) && (n as number) >= EMA_MIN_PERIOD && (n as number) <= EMA_MAX_PERIOD;
}

/** Reads stored prefs, falling back to the default for anything missing or invalid. */
export function parseChartPrefs(raw: string | null): ChartPrefs {
  if (!raw) return DEFAULT_CHART_PREFS;
  try {
    const p = JSON.parse(raw) as Partial<ChartPrefs>;
    const flag = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
    return {
      ema: DEFAULT_CHART_PREFS.ema.map((d, i) => {
        const s = Array.isArray(p.ema)
          ? (p.ema[i] as Partial<EmaLineSetting> | undefined)
          : undefined;
        return {
          period: isValidPeriod(s?.period) ? s.period : d.period,
          enabled: flag(s?.enabled, d.enabled),
        };
      }),
      showEma: flag(p.showEma, DEFAULT_CHART_PREFS.showEma),
      showLevels: flag(p.showLevels, DEFAULT_CHART_PREFS.showLevels),
      showVolume: flag(p.showVolume, DEFAULT_CHART_PREFS.showVolume),
    };
  } catch {
    return DEFAULT_CHART_PREFS;
  }
}

const listeners = new Set<() => void>();
/** Holds prefs for this page load when storage is blocked. */
let memoryRaw: string | null = null;

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(CHART_PREFS_KEY);
  } catch {
    return memoryRaw;
  }
}

// getSnapshot must return the same object while storage is unchanged.
let cached: { raw: string | null; prefs: ChartPrefs } = { raw: null, prefs: DEFAULT_CHART_PREFS };
function getSnapshot(): ChartPrefs {
  const raw = readRaw();
  if (raw !== cached.raw) cached = { raw, prefs: parseChartPrefs(raw) };
  return cached.prefs;
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key === CHART_PREFS_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function saveChartPrefs(prefs: ChartPrefs) {
  const raw = JSON.stringify(prefs);
  try {
    window.localStorage.setItem(CHART_PREFS_KEY, raw);
  } catch {
    memoryRaw = raw; // storage blocked: keep the change until the page reloads
  }
  for (const l of listeners) l();
}

/**
 * Chart prefs from this device. Server rendering and hydration use the
 * defaults; stored prefs apply right after (see CLAUDE.md, server vs browser).
 */
export function useChartPrefs(): [ChartPrefs, (next: ChartPrefs) => void] {
  const prefs = useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_CHART_PREFS);
  return [prefs, useCallback((next: ChartPrefs) => saveChartPrefs(next), [])];
}
