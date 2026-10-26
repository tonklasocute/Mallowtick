import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/cn";

export function Card({ className, ...props }: ComponentPropsWithoutRef<"section">) {
  return (
    <section
      className={cn("rounded-card border border-line bg-surface p-4 shadow-soft", className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: ComponentPropsWithoutRef<"h2">) {
  return (
    <h2 className={cn("font-display text-base font-semibold text-ink", className)} {...props} />
  );
}
