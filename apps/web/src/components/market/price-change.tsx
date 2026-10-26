import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import { cn } from "@/lib/cn";
import { direction, formatSignedChange, formatSignedPercent } from "@/lib/format";

interface PriceChangeProps {
  change: number | null;
  changePercent: number | null;
  variant?: "pill" | "text";
  showAbsolute?: boolean;
  className?: string;
}

const STYLES = {
  up: { text: "text-up", pill: "bg-up-soft text-up", Icon: ArrowUpRight, word: "Up" },
  down: { text: "text-down", pill: "bg-down-soft text-down", Icon: ArrowDownRight, word: "Down" },
  flat: {
    text: "text-slate-strong",
    pill: "bg-cream-deep text-slate-strong",
    Icon: Minus,
    word: "Unchanged",
  },
  unknown: {
    text: "text-slate",
    pill: "bg-cream-deep text-slate",
    Icon: Minus,
    word: "Change unavailable",
  },
} as const;

/** Change with arrow and color; the direction is also spelled out for screen readers. */
export function PriceChange({
  change,
  changePercent,
  variant = "text",
  showAbsolute = true,
  className,
}: PriceChangeProps) {
  const dir = direction(changePercent ?? change);
  const s = STYLES[dir];
  const parts = [
    showAbsolute ? formatSignedChange(change) : null,
    `(${formatSignedPercent(changePercent)})`,
  ].filter(Boolean);
  const text = showAbsolute ? parts.join(" ") : formatSignedPercent(changePercent);
  return (
    <span
      className={cn(
        "tabular inline-flex items-center gap-0.5 text-sm font-semibold",
        variant === "pill" ? cn("rounded-full px-2 py-0.5 text-xs", s.pill) : s.text,
        className,
      )}
    >
      <s.Icon aria-hidden className="size-3.5" strokeWidth={2.5} />
      <span className="sr-only">{s.word} </span>
      {text}
    </span>
  );
}
