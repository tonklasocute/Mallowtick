"use client";

import { Badge } from "@/components/ui/badge";
import { formatDuration } from "@/lib/format";
import { useMarketStatus } from "@/services/api/queries";

/** NYSE open/closed state from the provider; hidden when it can't be loaded. */
export function MarketStatusPill() {
  const { data, isError } = useMarketStatus();
  if (!data || isError) return null;
  const countdown = data.isOpen ? data.closesInSeconds : data.opensInSeconds;
  const suffix = countdown
    ? ` · ${data.isOpen ? "closes" : "opens"} in ${formatDuration(countdown)}`
    : "";
  return (
    <Badge
      tone={data.isOpen ? "mint" : "neutral"}
      title={`${data.name} status from ${data.freshness.provider}`}
    >
      <span
        aria-hidden
        className={data.isOpen ? "size-1.5 rounded-full bg-up" : "size-1.5 rounded-full bg-slate"}
      />
      {data.isOpen ? "Market open" : "Market closed"}
      {suffix}
    </Badge>
  );
}
