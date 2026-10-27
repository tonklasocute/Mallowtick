"use client";

import { cn } from "@/lib/cn";

interface SegmentedControlProps<T extends string> {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("flex gap-0.5 rounded-full bg-cream-deep p-1", className)}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(o.value)}
            className={cn(
              "min-h-10 flex-1 rounded-full px-2 font-display text-[13px] font-extrabold transition",
              selected ? "bg-ink text-surface shadow-pressed" : "text-slate hover:text-ink",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
