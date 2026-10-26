"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/cn";

import { NAV_ITEMS } from "./nav-items";

/** Mobile and tablet navigation; replaced by the sidebar on large screens. */
export function BottomNav() {
  const pathname = usePathname() ?? "/";
  return (
    <nav
      aria-label="เมนูหลัก"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm lg:hidden"
    >
      <ul className="mx-auto flex h-(--nav-height) max-w-md items-stretch">
        {NAV_ITEMS.map(({ href, label, Icon, match, fillWhenActive }) => {
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
                  fill={active && fillWhenActive ? "currentColor" : "none"}
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
