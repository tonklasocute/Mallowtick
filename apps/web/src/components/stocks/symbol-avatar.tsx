"use client";

import Image from "next/image";
import { useState } from "react";

import { cn } from "@/lib/cn";

const TINTS = ["bg-mint-soft", "bg-sky-soft", "bg-accent-soft", "bg-cream-deep"];

function tintFor(symbol: string): string {
  let h = 0;
  for (const ch of symbol) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TINTS[h % TINTS.length] ?? TINTS[0]!;
}

/** "circle" and "square" are list avatars; "tile" is the larger honey tile of Stock Detail. */
export type AvatarShape = "circle" | "square" | "tile";

/** Box size in px and classes per size and shape; the logo is requested at this size. */
function dimensions(size: "md" | "lg", shape: AvatarShape) {
  if (size === "lg") return { px: 56, box: "size-14 text-lg" };
  return shape === "square"
    ? { px: 44, box: "size-11 text-xs" }
    : { px: 40, box: "size-10 text-xs" };
}

/**
 * The company logo when the vendor has one, otherwise the ticker's initials. The initials
 * also show while the logo loads and stay if it fails (ETFs have no logo, and an offline
 * PWA can't fetch one).
 */
export function SymbolAvatar({
  symbol,
  logo,
  size = "md",
  shape = "circle",
}: {
  symbol: string;
  /** https URL from the API; "" or undefined for none. */
  logo?: string;
  size?: "md" | "lg";
  /** Discover's popular list uses rounded squares. */
  shape?: AvatarShape;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const showLogo = Boolean(logo) && failed !== logo;
  const { px, box } = dimensions(size, shape);
  return (
    <span
      aria-hidden
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden font-display font-bold text-ink",
        shape === "circle" ? "rounded-full" : shape === "square" ? "rounded-2xl" : "rounded-[20px]",
        shape === "tile" ? "border-2 border-honey-deep bg-honey" : tintFor(symbol),
        showLogo && shape !== "tile" && "border border-line",
        box,
      )}
    >
      {symbol.replace(/[.-].*$/, "").slice(0, 4)}
      {showLogo && (
        <Image
          src={logo!}
          alt=""
          width={px}
          height={px}
          onError={() => setFailed(logo!)}
          className="absolute inset-0 size-full bg-surface object-cover"
        />
      )}
    </span>
  );
}
