import type { ReactNode } from "react";

import { Mascot } from "@/components/brand/mascot";
import { cn } from "@/lib/cn";

interface StateMessageProps {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  /** Error states are announced to assistive technology. */
  tone?: "empty" | "error";
  compact?: boolean;
  className?: string;
}

/** Shared empty / error / unavailable state with the mascot. */
export function StateMessage({
  title,
  description,
  action,
  tone = "empty",
  compact,
  className,
}: StateMessageProps) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex flex-col items-center text-center",
        compact ? "gap-1.5 py-4" : "gap-2 py-8",
        className,
      )}
    >
      {!compact && <Mascot size={56} />}
      <p className="font-display text-base font-semibold text-ink">{title}</p>
      {description && <p className="max-w-xs text-sm text-slate">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
