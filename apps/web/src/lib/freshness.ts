import type { Freshness } from "@/types/api";

import { formatMarketTime } from "./format";

export type FreshnessKind = "live" | "delayed" | "eod" | "closed" | "stale" | "unknown";

export interface FreshnessInfo {
  kind: FreshnessKind;
  /** Short badge text. */
  label: string;
  /** Sentence with the timestamp the label is based on. */
  detail: string;
  /** Provider timestamp in market time, or "time n/a". */
  time: string;
}

export interface FreshnessInput {
  freshness: Freshness;
  /** Market state reported with the data, when known. */
  isMarketOpen: boolean | null;
  now: Date;
  online: boolean;
  /** When the browser last received this data (TanStack dataUpdatedAt). */
  receivedAt: number;
  /** Data the client has not refreshed for this long counts as stale. */
  staleAfterMs: number;
}

const LATENCY_LABEL: Record<Freshness["latency"], { kind: FreshnessKind; label: string }> = {
  realtime: { kind: "live", label: "Real-time" },
  delayed: { kind: "delayed", label: "Delayed" },
  eod: { kind: "eod", label: "End of day" },
  unknown: { kind: "unknown", label: "Latency not declared" },
};

/**
 * Decides how to label a piece of market data. Labels only claim what is
 * known: "Real-time" requires the operator to declare a real-time plan, and
 * anything served from a fallback cache, while offline, or not refreshed
 * recently is labelled stale with its actual timestamp.
 */
export function describeFreshness(input: FreshnessInput): FreshnessInfo {
  const { freshness, isMarketOpen, now, online, receivedAt, staleAfterMs } = input;
  const time = freshness.asOf ? formatMarketTime(freshness.asOf, now) : "time n/a";
  const asOf = freshness.asOf ? `as of ${time}` : "update time not reported";
  const fetched = `fetched ${formatMarketTime(freshness.fetchedAt, now)}`;

  if (!online) {
    return { kind: "stale", label: "Offline", detail: `Offline · showing data ${asOf}`, time };
  }
  if (freshness.stale) {
    return {
      kind: "stale",
      label: "Stale",
      detail: `Provider unavailable · showing data ${asOf} (${fetched})`,
      time,
    };
  }
  if (now.getTime() - receivedAt > staleAfterMs) {
    return { kind: "stale", label: "Stale", detail: `Not refreshed recently · ${asOf}`, time };
  }
  if (isMarketOpen === false) {
    const last = freshness.asOf ? `Last update ${time}` : "Last update time not reported";
    return { kind: "closed", label: "Market closed", detail: last, time };
  }
  const { kind, label } = LATENCY_LABEL[freshness.latency] ?? LATENCY_LABEL.unknown;
  return { kind, label, detail: `${label} · ${asOf}`, time };
}
