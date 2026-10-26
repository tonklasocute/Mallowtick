import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

const WIDTHS = {
  /** Single-column screens: phone width, a little wider on tablets and desktop. */
  narrow: "max-w-md md:max-w-2xl",
  /** Dashboard-style screens that switch to multi-column layouts on desktop. */
  wide: "max-w-md md:max-w-3xl lg:max-w-5xl",
} as const;

export function PageContainer({
  width = "narrow",
  className,
  children,
}: {
  width?: keyof typeof WIDTHS;
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn("mx-auto w-full", WIDTHS[width], className)}>{children}</div>;
}
