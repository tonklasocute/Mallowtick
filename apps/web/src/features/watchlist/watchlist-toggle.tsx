"use client";

import { Star } from "lucide-react";

import { cn } from "@/lib/cn";

import { useWatchlist } from "./use-watchlist";

export function WatchlistToggle({ symbol, className }: { symbol: string; className?: string }) {
  const wl = useWatchlist();
  const saved = wl.has(symbol);
  const label = saved ? `Remove ${symbol} from watchlist` : `Add ${symbol} to watchlist`;
  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={label}
      title={label}
      disabled={wl.isLoading}
      onClick={() => wl.toggle(symbol)}
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-full transition hover:bg-cream-deep disabled:opacity-50",
        saved ? "text-mint-deep" : "text-slate",
        className,
      )}
    >
      <Star
        aria-hidden
        className="size-5"
        strokeWidth={2.25}
        fill={saved ? "currentColor" : "none"}
      />
    </button>
  );
}
