"use client";

import { CalendarDays } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { MARKET_TIMEZONE } from "@/lib/config";
import { vendorLabel } from "@/lib/providers";
import { useEarnings } from "@/services/api/queries";

const HOURS: Record<string, string> = {
  bmo: "ก่อนตลาดเปิด",
  amc: "หลังตลาดปิด",
  dmh: "ระหว่างเวลาทำการ",
};

/** "2 พ.ย." from "2026-11-02". It is a calendar date, so it is formatted in UTC. */
export function formatEarningsDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString("th-TH-u-ca-gregory", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** Today's date (YYYY-MM-DD) in US market time. */
function marketToday(now: Date): string {
  return now.toLocaleDateString("en-CA", { timeZone: MARKET_TIMEZONE });
}

/**
 * The next scheduled earnings report, from the vendor's calendar. Renders
 * nothing when no vendor publishes one or no report is scheduled.
 */
export function EarningsBadge({ symbol, now = new Date() }: { symbol: string; now?: Date }) {
  const { data } = useEarnings(symbol);
  const next = data?.next;
  if (!next || next.date < marketToday(now)) return null;
  const hour = HOURS[next.hour];
  return (
    <Badge tone="sky" title={`ปฏิทินประกาศงบจาก ${vendorLabel(data.freshness.provider)}`}>
      <CalendarDays aria-hidden className="size-3.5" />
      ประกาศงบ {formatEarningsDate(next.date)}
      {hour && ` · ${hour}`}
    </Badge>
  );
}
