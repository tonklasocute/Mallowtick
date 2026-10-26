"use client";

import { Compass, Settings2, Star } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/cn";

const ITEMS = [
  {
    href: "/",
    label: "Discover",
    Icon: Compass,
    match: (p: string) => p === "/" || p.startsWith("/stocks"),
  },
  {
    href: "/watchlist",
    label: "Watchlist",
    Icon: Star,
    match: (p: string) => p.startsWith("/watchlist"),
  },
  { href: "/more", label: "More", Icon: Settings2, match: (p: string) => p.startsWith("/more") },
] as const;

export function BottomNav() {
  const pathname = usePathname() ?? "/";
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm"
    >
      <ul className="mx-auto flex h-(--nav-height) max-w-md items-stretch">
        {ITEMS.map(({ href, label, Icon, match }) => {
          const active = match(pathname);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-full flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition",
                  active ? "text-mint-deep" : "text-slate hover:text-ink",
                )}
              >
                <Icon
                  aria-hidden
                  className="size-5"
                  strokeWidth={active ? 2.5 : 2}
                  fill={active && label === "Watchlist" ? "currentColor" : "none"}
                />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
