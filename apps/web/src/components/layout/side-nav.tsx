"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Logo } from "@/components/brand/logo";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/cn";

import { NAV_ITEMS } from "./nav-items";

/** Desktop navigation (large screens only). */
export function SideNav() {
  const pathname = usePathname() ?? "/";
  return (
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-(--sidebar-width) flex-col border-r border-line bg-surface/70 px-4 py-6 lg:flex">
      <Link href="/" className="px-2" aria-label={`หน้าแรก ${BRAND.name}`}>
        <Logo />
      </Link>
      <p className="mt-1 px-2 font-display text-xs text-slate-strong">{BRAND.tagline}</p>
      <nav aria-label="เมนูหลัก" className="mt-8">
        <ul className="space-y-1">
          {NAV_ITEMS.map(({ href, label, Icon, match, fillWhenActive }) => {
            const active = match(pathname);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-11 items-center gap-3 rounded-2xl px-3 text-sm font-semibold transition",
                    active
                      ? "bg-mint-soft text-mint-deep"
                      : "text-slate-strong hover:bg-cream-deep",
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
      <p className="mt-auto px-2 text-[11px] leading-relaxed text-slate">
        ข้อมูลตลาดหุ้นสหรัฐฯ ใช้ประกอบการตัดสินใจเท่านั้น ไม่ใช่คำแนะนำการลงทุน
      </p>
    </aside>
  );
}
