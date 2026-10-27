import { cn } from "@/lib/cn";

interface MascotProps {
  size?: number;
  className?: string;
  /** Decorative by default; pass a label when the mascot conveys meaning. */
  label?: string;
}

/**
 * Mallow, the marshmallow mascot: a white body with a dark outline and a two-leaf
 * sprout, as drawn on the Claude design canvas. Colors come from design tokens.
 */
export function Mascot({ size = 40, className, label }: MascotProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={cn("shrink-0", className)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path
        d="M32 16 C32 10 30 7 27 5"
        className="fill-none stroke-candle-up"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path d="M30 9 C24 3 16 5 15 10 C21 13 27 12 30 9 Z" className="fill-mint" />
      <path d="M31 10 C35 3 43 3 46 7 C41 12 35 13 31 10 Z" className="fill-candle-up" />
      <rect
        x="10"
        y="16"
        width="44"
        height="42"
        rx="18"
        className="fill-surface stroke-ink"
        strokeWidth="2.5"
      />
      <path
        d="M16.5 27.6 Q17.8 21.2 24.2 19.2"
        className="fill-none stroke-line"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <circle cx="24" cy="36" r="3" className="fill-ink" />
      <circle cx="40" cy="36" r="3" className="fill-ink" />
      <circle cx="25" cy="35" r="0.9" className="fill-surface" />
      <circle cx="41" cy="35" r="0.9" className="fill-surface" />
      <ellipse cx="18" cy="43" rx="4" ry="2.6" className="fill-accent" />
      <ellipse cx="46" cy="43" rx="4" ry="2.6" className="fill-accent" />
      <path
        d="M28 43 Q32 47 36 43"
        className="fill-none stroke-ink"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
