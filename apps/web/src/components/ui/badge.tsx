import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export type BadgeTone = "mint" | "sky" | "accent" | "neutral";

const TONES: Record<BadgeTone, string> = {
  mint: "bg-mint-soft text-mint-deep",
  sky: "bg-sky-soft text-ink",
  accent: "bg-accent-soft text-down",
  neutral: "bg-cream-deep text-slate-strong",
};

export function Badge({
  tone = "neutral",
  children,
  className,
  title,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
