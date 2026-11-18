import { CalendarDays, Newspaper, Scale, Sparkles, type LucideIcon } from "lucide-react";
import Link from "next/link";

import { ICON_TONES, type IconTone } from "@/features/stock-detail/detail-ui";
import { cn } from "@/lib/cn";

const TOOLS: { href: string; label: string; hint: string; Icon: LucideIcon; tone: IconTone }[] = [
  {
    href: "/briefing",
    label: "สรุปตลาดวันนี้",
    hint: "ข้อสังเกตของหุ้นของคุณ",
    Icon: Sparkles,
    tone: "mint",
  },
  {
    href: "/earnings",
    label: "ปฏิทินงบ",
    hint: "ใครประกาศงบเมื่อไร",
    Icon: CalendarDays,
    tone: "lavender",
  },
  { href: "/news", label: "ข่าว", hint: "ข่าวของหุ้นที่ติดตาม", Icon: Newspaper, tone: "sky" },
  {
    href: "/compare",
    label: "เปรียบเทียบหุ้น",
    hint: "ตัวเลขเทียบกันสูงสุด 4 ตัว",
    Icon: Scale,
    tone: "honey",
  },
];

/** Shortcuts to the research screens, as pastel tiles. */
export function DiscoverTools() {
  return (
    <nav aria-label="เครื่องมือ" className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
      {TOOLS.map(({ href, label, hint, Icon, tone }) => (
        <Link
          key={href}
          href={href}
          className="flex min-h-16 items-center gap-2.5 rounded-[20px] border border-line bg-surface px-3 py-2.5 shadow-soft transition hover:border-line-strong"
        >
          <span
            aria-hidden
            className={cn(
              "grid size-9 shrink-0 place-items-center rounded-[12px]",
              ICON_TONES[tone],
            )}
          >
            <Icon className="size-[18px]" strokeWidth={2.2} />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[14px] font-medium text-ink">{label}</span>
            <span className="block truncate text-[11px] font-light text-slate">{hint}</span>
          </span>
        </Link>
      ))}
    </nav>
  );
}
