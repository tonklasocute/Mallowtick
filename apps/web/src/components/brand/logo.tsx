import { TrendingUp } from "lucide-react";

import { Mascot } from "./mascot";

export function Logo() {
  return (
    <span className="inline-flex items-center gap-2">
      <Mascot size={36} />
      <span className="relative font-display text-2xl font-bold tracking-tight text-ink">
        Mallowtick
        <TrendingUp
          aria-hidden
          className="absolute -top-2.5 -right-4 size-4 text-mint-deep"
          strokeWidth={2.75}
        />
      </span>
    </span>
  );
}
