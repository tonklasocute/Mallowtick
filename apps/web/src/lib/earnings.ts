import type { EarningsEvent, EarningsOutcome } from "@/types/api";

import { MARKET_TIMEZONE } from "./config";
import { EMPTY, formatCompact } from "./format";

/** When a company reports, as the vendor gives it. */
export const HOUR_LABELS: Record<string, string> = {
  bmo: "ก่อนตลาดเปิด",
  amc: "หลังตลาดปิด",
  dmh: "ระหว่างเวลาทำการ",
};

/**
 * The same moment in Thai time. US dates are New York dates: a report after the close lands
 * in the early hours of the next day in Thailand, one before the open in the evening.
 */
export const HOUR_THAI_HINTS: Record<string, string> = {
  bmo: "ช่วงค่ำวันเดียวกันตามเวลาไทย",
  amc: "เช้ามืดวันถัดไปตามเวลาไทย",
  dmh: "ช่วงดึกตามเวลาไทย",
};

export const hourLabel = (hour: string) => HOUR_LABELS[hour] ?? "ยังไม่ระบุเวลา";

/** Today's date (YYYY-MM-DD) in US market time. */
export function marketToday(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: MARKET_TIMEZONE });
}

/** Shifts a YYYY-MM-DD date; it is a calendar date, so the arithmetic is done in UTC. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type CalendarTab = "today" | "upcoming" | "past";

/** How far the upcoming and past tabs reach: two weeks, the most a request may cover at once. */
export const CALENDAR_SPAN_DAYS = 14;

/** The date range a tab asks the API for. */
export function calendarWindow(tab: CalendarTab, today: string): { from: string; to: string } {
  switch (tab) {
    case "today":
      return { from: today, to: today };
    case "upcoming":
      return { from: addDays(today, 1), to: addDays(today, CALENDAR_SPAN_DAYS - 1) };
    case "past":
      return { from: addDays(today, -(CALENDAR_SPAN_DAYS - 1)), to: addDays(today, -1) };
  }
}

/**
 * EPS with up to four decimals: estimates are averages like -0.0765, and rounding them to
 * cents would show "-0.08 vs -0.08" next to a 4.6% miss.
 */
export function formatEps(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return EMPTY;
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(v);
}

/**
 * "115.84B" for revenue. No currency symbol: the earnings vendor reports figures in the
 * company's own reporting currency without naming it, and for foreign ADRs that is not the
 * dollar (PDD's and Baidu's revenue estimates are in yuan).
 */
export function formatAmountCompact(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return EMPTY;
  return formatCompact(v);
}

/** Said wherever earnings figures appear without a currency. */
export const REPORTING_CURRENCY_NOTE =
  "ตัวเลขงบเป็นสกุลเงินที่บริษัทรายงาน บริษัทต่างประเทศอาจไม่ใช่ USD";

/**
 * (actual − estimate) / |estimate| in percent, so a smaller loss than expected is positive.
 * Null without both values or with a zero estimate, as in the API.
 */
export function surprisePercent(
  actual: number | null | undefined,
  estimate: number | null | undefined,
): number | null {
  if (actual == null || estimate == null || estimate === 0) return null;
  return ((actual - estimate) / Math.abs(estimate)) * 100;
}

/**
 * Beat, miss or inline (equal), like the API's results: a sub-cent difference still counts,
 * and a zero estimate or actual is a value, not a missing one.
 */
export function compareOutcome(
  actual: number | null | undefined,
  estimate: number | null | undefined,
): EarningsOutcome {
  if (actual == null || estimate == null) return "";
  const d = actual - estimate;
  if (Math.abs(d) <= 1e-9) return "inline";
  return d > 0 ? "beat" : "miss";
}

export const OUTCOME_LABELS: Record<Exclude<EarningsOutcome, "">, string> = {
  beat: "ดีกว่าคาด",
  miss: "ต่ำกว่าคาด",
  inline: "ตรงตามคาด",
};

/** True once the company has published either figure. */
export const isReported = (e: EarningsEvent) => e.epsActual !== null || e.revenueActual !== null;

/**
 * A day's reports in reading order: the user's own stocks first, then the larger companies
 * (by the analysts' revenue estimate, the only size the calendar carries), then by ticker.
 */
export function sortDay(events: EarningsEvent[], mine: ReadonlySet<string>): EarningsEvent[] {
  return [...events].sort(
    (a, b) =>
      Number(mine.has(b.symbol)) - Number(mine.has(a.symbol)) ||
      (b.revenueEstimate ?? -Infinity) - (a.revenueEstimate ?? -Infinity) ||
      a.symbol.localeCompare(b.symbol),
  );
}

/** Events grouped by date, dates in order (newest first when `newestFirst`). */
export function groupByDate(
  events: EarningsEvent[],
  mine: ReadonlySet<string>,
  newestFirst = false,
): { date: string; events: EarningsEvent[] }[] {
  const byDate = new Map<string, EarningsEvent[]>();
  for (const e of events) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
  const dates = [...byDate.keys()].sort();
  if (newestFirst) dates.reverse();
  return dates.map((date) => ({ date, events: sortDay(byDate.get(date)!, mine) }));
}

/** Keeps events whose ticker or known name contains the query (case-insensitive). */
export function matchesQuery(e: EarningsEvent, query: string): boolean {
  const q = query.trim().toUpperCase();
  if (!q) return true;
  return e.symbol.includes(q) || (e.name ?? "").toUpperCase().includes(q);
}

/** The first `limit` events across the groups, for showing a long list a page at a time. */
export function firstEvents<G extends { events: EarningsEvent[] }>(
  groups: G[],
  limit: number,
): G[] {
  const out: G[] = [];
  let left = limit;
  for (const g of groups) {
    if (left <= 0) break;
    const events = g.events.slice(0, left);
    left -= events.length;
    out.push({ ...g, events });
  }
  return out;
}
