import { cn } from "@/lib/cn";

interface MascotProps {
  size?: number;
  className?: string;
  /** Decorative by default; pass a label when the mascot conveys meaning. */
  label?: string;
}

/** Mallow, the marshmallow mascot. Colors come from design tokens. */
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
        d="M32 15 C32 12 32 10 32.5 8"
        className="fill-none stroke-mint-deep"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <ellipse
        cx="26.5"
        cy="8"
        rx="5.2"
        ry="3"
        transform="rotate(-25 26.5 8)"
        className="fill-mint stroke-mint-deep"
        strokeWidth="1.2"
      />
      <ellipse
        cx="38"
        cy="7"
        rx="5.2"
        ry="3"
        transform="rotate(20 38 7)"
        className="fill-mint stroke-mint-deep"
        strokeWidth="1.2"
      />
      <rect
        x="11"
        y="15"
        width="42"
        height="43"
        rx="16"
        className="fill-surface stroke-peach"
        strokeWidth="2"
      />
      <path d="M15 46 C20 54 44 54 49 46 L49 44 C49 52 15 52 15 44 Z" className="fill-cream-deep" />
      <circle cx="25" cy="35" r="2.8" className="fill-ink" />
      <circle cx="39" cy="35" r="2.8" className="fill-ink" />
      <circle cx="26" cy="34" r="0.9" className="fill-surface" />
      <circle cx="40" cy="34" r="0.9" className="fill-surface" />
      <path
        d="M29 40.5 Q32 43.5 35 40.5"
        className="fill-none stroke-ink"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <ellipse cx="19.5" cy="40.5" rx="3.4" ry="2.1" className="fill-accent" opacity="0.75" />
      <ellipse cx="44.5" cy="40.5" rx="3.4" ry="2.1" className="fill-accent" opacity="0.75" />
    </svg>
  );
}
