"use client";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { useNow } from "@/hooks/use-now";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { cn } from "@/lib/cn";
import { CLIENT_STALE_AFTER_MS } from "@/lib/config";
import { describeFreshness, type FreshnessKind } from "@/lib/freshness";
import type { Freshness } from "@/types/api";

const TONE: Record<FreshnessKind, BadgeTone> = {
  live: "mint",
  delayed: "sky",
  eod: "sky",
  closed: "neutral",
  stale: "accent",
  unknown: "neutral",
};

const DOT: Record<FreshnessKind, string> = {
  live: "bg-up",
  delayed: "bg-sky",
  eod: "bg-sky",
  closed: "bg-slate",
  stale: "bg-down",
  unknown: "bg-slate",
};

interface FreshnessProps {
  freshness: Freshness;
  isMarketOpen: boolean | null;
  /** When the client received the data (TanStack Query dataUpdatedAt). */
  receivedAt: number;
}

function useFreshness({ freshness, isMarketOpen, receivedAt }: FreshnessProps) {
  const now = useNow();
  const online = useOnlineStatus();
  return describeFreshness({
    freshness,
    isMarketOpen,
    now,
    online,
    receivedAt,
    staleAfterMs: CLIENT_STALE_AFTER_MS,
  });
}

/** Badge plus a line stating the timestamp the label is based on. */
export function FreshnessBadge(
  props: FreshnessProps & { showDetail?: boolean; className?: string },
) {
  const info = useFreshness(props);
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-2 gap-y-1", props.className)}>
      <Badge tone={TONE[info.kind]}>
        <span aria-hidden className={cn("size-1.5 rounded-full", DOT[info.kind])} />
        {info.label}
      </Badge>
      {props.showDetail !== false && <span className="text-xs text-slate">{info.detail}</span>}
    </span>
  );
}

/** Compact dot + time for list rows; the full sentence is available to screen readers and on hover. */
export function FreshnessInline(props: FreshnessProps & { className?: string }) {
  const info = useFreshness(props);
  return (
    <span
      className={cn("inline-flex items-center gap-1 text-[11px] text-slate", props.className)}
      title={info.detail}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", DOT[info.kind])} />
      <span className="sr-only">{info.detail}</span>
      <span aria-hidden>{info.kind === "stale" ? `${info.label} · ${info.time}` : info.time}</span>
    </span>
  );
}
