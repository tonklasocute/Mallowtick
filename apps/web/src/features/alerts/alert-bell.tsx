"use client";

import { Bell } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/cn";

import { useAlerts } from "./use-alerts";

/** Opens the alerts screen; shows how many alerts are unread. */
export function AlertBell({ className }: { className?: string }) {
  const { unread } = useAlerts();
  const label = unread > 0 ? `การแจ้งเตือน ยังไม่อ่าน ${unread} รายการ` : "การแจ้งเตือน";
  return (
    <Link
      href="/alerts"
      aria-label={label}
      title={label}
      className={cn(
        "relative inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-ink transition hover:bg-cream-deep",
        className,
      )}
    >
      <Bell aria-hidden className="size-5" strokeWidth={2.2} />
      {unread > 0 && (
        <span
          aria-hidden
          className="absolute -top-0.5 -right-0.5 grid min-w-5 place-items-center rounded-full bg-down-fill px-1 font-display text-[10.5px] font-black text-surface"
        >
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}
