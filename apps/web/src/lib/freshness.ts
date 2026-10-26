import type { Freshness } from "@/types/api";

import { formatMarketTime } from "./format";

export type FreshnessKind = "live" | "delayed" | "eod" | "closed" | "stale" | "unknown";

export interface FreshnessInfo {
  kind: FreshnessKind;
  /** Short badge text. */
  label: string;
  /** Sentence with the timestamp the label is based on. */
  detail: string;
  /** Provider timestamp in market time, or "ไม่ระบุเวลา". */
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
  realtime: { kind: "live", label: "เรียลไทม์" },
  delayed: { kind: "delayed", label: "ล่าช้า" },
  eod: { kind: "eod", label: "ราคาปิดสิ้นวัน" },
  unknown: { kind: "unknown", label: "ไม่ระบุความล่าช้า" },
};

/**
 * Decides how to label a piece of market data. Labels only claim what is
 * known: "Real-time" requires the operator to declare a real-time plan, and
 * anything served from a fallback cache, while offline, or not refreshed
 * recently is labelled stale with its actual timestamp.
 */
export function describeFreshness(input: FreshnessInput): FreshnessInfo {
  const { freshness, isMarketOpen, now, online, receivedAt, staleAfterMs } = input;
  const time = freshness.asOf ? formatMarketTime(freshness.asOf, now) : "ไม่ระบุเวลา";
  const asOf = freshness.asOf ? `ณ ${time}` : "(ไม่ได้ระบุเวลาอัปเดต)";
  const fetched = `ดึงข้อมูลเมื่อ ${formatMarketTime(freshness.fetchedAt, now)}`;

  if (!online) {
    return { kind: "stale", label: "ออฟไลน์", detail: `ออฟไลน์ · แสดงข้อมูล ${asOf}`, time };
  }
  if (freshness.stale) {
    return {
      kind: "stale",
      label: "ข้อมูลเก่า",
      detail: `ผู้ให้บริการไม่พร้อมใช้งาน · แสดงข้อมูล ${asOf} (${fetched})`,
      time,
    };
  }
  if (now.getTime() - receivedAt > staleAfterMs) {
    return { kind: "stale", label: "ข้อมูลเก่า", detail: `ไม่ได้รีเฟรชมาสักพัก · ${asOf}`, time };
  }
  if (isMarketOpen === false) {
    const last = freshness.asOf ? `อัปเดตล่าสุด ${time}` : "ไม่ได้ระบุเวลาอัปเดตล่าสุด";
    return { kind: "closed", label: "ตลาดปิด", detail: last, time };
  }
  const { kind, label } = LATENCY_LABEL[freshness.latency] ?? LATENCY_LABEL.unknown;
  return { kind, label, detail: `${label} · ${asOf}`, time };
}
