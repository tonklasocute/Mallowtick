import { MARKET_TIMEZONE } from "./config";

export const EMPTY = "—";

const isNum = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);

export function formatPrice(value: number | null | undefined, currency = "USD"): string {
  if (!isNum(value)) return EMPTY;
  const digits = Math.abs(value) < 1 ? 4 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/** A plain price without currency symbol, for dense tables and chart labels. */
export function formatNumber(value: number | null | undefined, digits = 2): string {
  if (!isNum(value)) return EMPTY;
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatSignedChange(value: number | null | undefined): string {
  if (!isNum(value)) return EMPTY;
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: "exceptZero",
  }).format(value);
}

/** Formats a percentage expressed in percent units (0.99 → "+0.99%"). */
export function formatSignedPercent(value: number | null | undefined): string {
  if (!isNum(value)) return EMPTY;
  return `${formatSignedChange(value)}%`;
}

export function formatCompact(value: number | null | undefined): string {
  if (!isNum(value)) return EMPTY;
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(
    value,
  );
}

export type Direction = "up" | "down" | "flat" | "unknown";

export function direction(change: number | null | undefined): Direction {
  if (!isNum(change)) return "unknown";
  // Treat sub-cent noise as flat so the color never contradicts a "0.00" label.
  if (Math.abs(change) < 0.005) return "flat";
  return change > 0 ? "up" : "down";
}

/** "3:59 PM ET" for today, "Oct 23, 3:59 PM ET" otherwise (in market time). */
export function formatMarketTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return EMPTY;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return EMPTY;
  const day = (x: Date) => x.toLocaleDateString("en-US", { timeZone: MARKET_TIMEZONE });
  const time = d.toLocaleTimeString("en-US", {
    timeZone: MARKET_TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
  });
  if (day(d) === day(now)) return `${time} ET`;
  const date = d.toLocaleDateString("en-US", {
    timeZone: MARKET_TIMEZONE,
    month: "short",
    day: "numeric",
  });
  return `${date}, ${time} ET`;
}

export function formatMarketDate(iso: string | null | undefined): string {
  if (!iso) return EMPTY;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return EMPTY;
  return d.toLocaleDateString("en-US", {
    timeZone: MARKET_TIMEZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** "2h 15m" from seconds; used for market open/close countdowns. */
export function formatDuration(seconds: number | null | undefined): string {
  if (!isNum(seconds) || seconds <= 0) return EMPTY;
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${Math.max(m, 1)}m`;
}

/** Bar timestamp label: date only for daily/weekly bars, which have no meaningful time of day. */
export function formatBarTime(
  iso: string | null | undefined,
  interval: string,
  now: Date = new Date(),
): string {
  return interval === "1day" || interval === "1week"
    ? formatMarketDate(iso)
    : formatMarketTime(iso, now);
}
