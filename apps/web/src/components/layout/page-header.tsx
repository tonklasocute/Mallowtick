import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

interface PageHeaderProps {
  title?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}

/** Sticky header that clears the iPhone status bar in standalone mode. */
export function PageHeader({ title, leading, trailing, className }: PageHeaderProps) {
  return (
    <header className={cn("pt-safe sticky top-0 z-10 bg-cream/95 backdrop-blur-sm", className)}>
      <div className="flex min-h-14 items-center gap-2 px-4">
        {leading}
        <div className="min-w-0 flex-1">
          {typeof title === "string" ? (
            <h1 className="truncate font-display text-2xl font-bold text-ink">{title}</h1>
          ) : (
            title
          )}
        </div>
        {trailing && <div className="flex items-center gap-1">{trailing}</div>}
      </div>
    </header>
  );
}
