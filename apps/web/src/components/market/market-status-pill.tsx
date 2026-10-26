"use client";

import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/format";
import { useMarketStatus } from "@/services/api/queries";

/** NYSE open/closed state from the provider; hidden when it can't be loaded. */
export function MarketStatusPill({ className }: { className?: string }) {
  const { data, isError } = useMarketStatus();
  if (!data || isError) return null;
  const countdown = data.isOpen ? data.closesInSeconds : data.opensInSeconds;
  const suffix = countdown
    ? ` · ${data.isOpen ? "ปิด" : "เปิด"}ในอีก ${formatDuration(countdown)}`
    : "";
  return (
    <span
      title={`สถานะ ${data.name} จาก ${data.freshness.provider}`}
      className={cn(
        "inline-flex items-center gap-2 rounded-full bg-surface py-1.5 pr-3 pl-2.5 text-[11.5px] font-medium whitespace-nowrap text-ink shadow-soft",
        className,
      )}
    >
      <span aria-hidden className="relative flex size-2">
        {data.isOpen && (
          <span className="absolute inset-0 animate-ping rounded-full bg-up opacity-60" />
        )}
        <span className={cn("relative size-2 rounded-full", data.isOpen ? "bg-up" : "bg-slate")} />
      </span>
      {data.isOpen ? "ตลาดเปิด" : "ตลาดปิด"}
      {suffix}
    </span>
  );
}
