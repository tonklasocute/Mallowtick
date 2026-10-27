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
      {/* Four tabs don't fit side by side on a phone: the others stack the icon over the label. */}
      <ul className="flex h-(--nav-height) items-center justify-between gap-0.5 px-2">
        {NAV_ITEMS.map(({ href, label, Icon, match, fillWhenActive }) => {
          const active = match(pathname);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center rounded-full whitespace-nowrap transition",
                  active
                    ? "h-12 gap-1.5 bg-ink px-3.5 text-[13px] text-surface min-[380px]:px-4"
                    : "min-w-14 flex-col gap-0.5 px-1 py-1.5 text-[11px] text-slate hover:text-ink",
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
