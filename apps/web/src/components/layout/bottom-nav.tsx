"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/cn";

import { NAV_ITEMS } from "./nav-items";

/** Mobile and tablet navigation, a floating pill; replaced by the sidebar on large screens. */
export function BottomNav() {
  const pathname = usePathname() ?? "/";
  return (
    <nav
      aria-label="เมนูหลัก"
      className="fixed inset-x-4 bottom-(--nav-offset) z-20 mx-auto max-w-md rounded-full border border-line bg-surface/95 shadow-float backdrop-blur-sm lg:hidden"
    >
      <ul className="flex h-(--nav-height) items-center justify-around gap-1 px-2">
        {NAV_ITEMS.map(({ href, label, Icon, match, fillWhenActive }) => {
          const active = match(pathname);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-12 items-center gap-1.5 rounded-full px-3 text-[13px] min-[380px]:px-4 whitespace-nowrap transition",
                  active ? "bg-ink text-surface" : "text-slate hover:text-ink",
                )}
              >
                <Icon
                  aria-hidden
                  className="size-5 shrink-0"
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
