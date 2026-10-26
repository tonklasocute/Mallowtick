import { cn } from "@/lib/cn";

const TINTS = ["bg-mint-soft", "bg-sky-soft", "bg-accent-soft", "bg-cream-deep"];

function tintFor(symbol: string): string {
  let h = 0;
  for (const ch of symbol) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TINTS[h % TINTS.length] ?? TINTS[0]!;
}

/** Initials badge. Company logos are not used in V1. */
export function SymbolAvatar({ symbol, size = "md" }: { symbol: string; size?: "md" | "lg" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-display font-bold text-ink",
        size === "lg" ? "size-14 text-lg" : "size-10 text-xs",
        tintFor(symbol),
      )}
    >
      {symbol.replace(/[.-].*$/, "").slice(0, 4)}
    </span>
  );
}
