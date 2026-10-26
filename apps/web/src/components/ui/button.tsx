import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/cn";

type Variant = "primary" | "soft" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-mint-deep text-surface hover:brightness-110",
  soft: "bg-mint-soft text-mint-deep hover:bg-mint/50",
  ghost: "text-slate-strong hover:bg-cream-deep",
};

export function Button({
  variant = "soft",
  className,
  ...props
}: ComponentPropsWithoutRef<"button"> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-semibold transition disabled:opacity-50",
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}

export function IconButton({
  label,
  className,
  ...props
}: ComponentPropsWithoutRef<"button"> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-10 items-center justify-center rounded-full text-ink transition hover:bg-cream-deep",
        className,
      )}
      {...props}
    />
  );
}
