import { Info, type LucideIcon } from "lucide-react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "@/lib/cn";
import { direction, formatMarketTime, formatSignedChange, formatSignedPercent } from "@/lib/format";
import { vendorLabel } from "@/lib/providers";
import type { Freshness } from "@/types/api";

/*
 * Building blocks of the Stock Detail cards, after the "RKLB" artboards of the
 * Claude design canvas: 26px cards, pastel icon tiles, soft tiles and note boxes.
 */

export function DetailCard({ className, ...props }: ComponentPropsWithoutRef<"section">) {
  return (
    <section
      className={cn(
        "flex flex-col gap-3.5 rounded-panel border border-line bg-surface p-4 shadow-soft",
        className,
      )}
      {...props}
    />
  );
}

export type IconTone = "sky" | "honey" | "lavender" | "mint" | "pink";

export const ICON_TONES: Record<IconTone, string> = {
  sky: "bg-sky-soft text-sky-ink",
  honey: "bg-honey text-honey-ink",
  lavender: "bg-lavender text-lavender-ink",
  mint: "bg-mint-soft text-up",
  pink: "bg-accent-soft text-down",
};

/** Card title after its pastel icon tile, with an optional badge on the right. */
export function CardHeading({
  icon: Icon,
  tone,
  title,
  badge,
}: {
  icon: LucideIcon;
  tone: IconTone;
  title: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-[17px] font-medium text-ink">
        <span
          aria-hidden
          className={cn(
            "grid size-[30px] shrink-0 place-items-center rounded-[10px]",
            ICON_TONES[tone],
          )}
        >
          <Icon className="size-4" strokeWidth={2.2} />
        </span>
        {title}
      </h2>
      {badge}
    </div>
  );
}

export function CardBadge({
  children,
  tone = "sky",
}: {
  children: ReactNode;
  tone?: "sky" | "soft";
}) {
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-1 text-[11px] whitespace-nowrap",
        tone === "sky" ? "bg-sky-soft text-sky-ink" : "bg-cream-deep text-slate",
      )}
    >
      {children}
    </span>
  );
}

/** A grid of tiles; each Tile is a term and its value, so the value is the label's next sibling. */
export function TileGrid({
  cols,
  className,
  children,
}: {
  cols: 2 | 3 | 4;
  className?: string;
  children: ReactNode;
}) {
  return (
    <dl
      className={cn(
        "grid",
        cols === 4 ? "grid-cols-4 gap-1.5" : cols === 3 ? "grid-cols-3 gap-2" : "grid-cols-2 gap-2",
        className,
      )}
    >
      {children}
    </dl>
  );
}

export function Tile({
  label,
  value,
  sub,
  size = "md",
  valueClassName,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  size?: "sm" | "md" | "lg";
  /** Colour of the value; text-ink when not given. */
  valueClassName?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col bg-cream-deep",
        size === "sm" ? "gap-px rounded-[14px] px-2.5 py-2" : "gap-0.5 rounded-2xl px-3 py-2.5",
      )}
    >
      <dt className="truncate text-[11.5px] text-slate">{label}</dt>
      <dd
        className={cn(
          "tabular truncate font-display font-black",
          size === "lg"
            ? "text-[22px] tracking-[-0.3px]"
            : size === "sm"
              ? "text-[15px]"
              : "text-base",
          valueClassName ?? "text-ink",
        )}
      >
        {value}
      </dd>
      {sub && <dd className="text-[11px] font-semibold text-slate">{sub}</dd>}
    </div>
  );
}

/** Muted small print on the soft background. */
export function NoteBox({ children, icon = false }: { children: ReactNode; icon?: boolean }) {
  return (
    <div className="flex gap-2.5 rounded-2xl bg-cream-deep px-3.5 py-3 text-[11.5px] leading-[1.7] font-light text-slate">
      {icon && <Info aria-hidden className="mt-[3px] size-4 shrink-0" strokeWidth={2} />}
      <p>{children}</p>
    </div>
  );
}

/** "… · ข้อมูลจาก Finnhub · อัปเดต 11:32 PM ET" for the vendor-sourced cards. */
export function SourceNote({
  freshness,
  children,
  icon,
}: {
  freshness: Freshness;
  children?: ReactNode;
  icon?: boolean;
}) {
  return (
    <NoteBox icon={icon}>
      {children && <>{children} · </>}
      ข้อมูลจาก {vendorLabel(freshness.provider)} · อัปเดต {formatMarketTime(freshness.fetchedAt)}
      {freshness.stale && " (ข้อมูลเก่า ผู้ให้บริการไม่ตอบสนอง)"}
    </NoteBox>
  );
}

const DELTA = {
  up: { pill: "bg-up-soft text-up", glyph: "▲", word: "ขึ้น" },
  down: { pill: "bg-down-soft text-down", glyph: "▼", word: "ลง" },
  flat: { pill: "bg-cream-deep text-slate-strong", glyph: "", word: "ไม่เปลี่ยนแปลง" },
  unknown: { pill: "bg-cream-deep text-slate", glyph: "", word: "ไม่มีข้อมูลการเปลี่ยนแปลง" },
} as const;

/** "▲ +1.22 (+2.32%)" on green or "▼ …" on pink; the direction is spelled out for screen readers. */
export function DeltaPill({
  change,
  changePercent,
  className,
}: {
  change: number | null;
  changePercent: number | null;
  className?: string;
}) {
  const s = DELTA[direction(changePercent ?? change)];
  return (
    <span
      className={cn(
        "tabular inline-flex items-center gap-1 rounded-full px-[11px] py-[5px] font-display text-[13px] font-extrabold whitespace-nowrap",
        s.pill,
        className,
      )}
    >
      {s.glyph && <span aria-hidden>{s.glyph}</span>}
      <span className="sr-only">{s.word} </span>
      {`${formatSignedChange(change)} (${formatSignedPercent(changePercent)})`}
    </span>
  );
}

/** A value's text colour by sign, for returns, growth and margins. */
export function signedTextClass(value: number | null | undefined): string {
  const dir = direction(value);
  return dir === "up" ? "text-up" : dir === "down" ? "text-down" : "text-ink";
}

/**
 * A bar from the centre of a track: right for positive, left for negative, its length
 * |value| / scale of the half track. Returns, margins and ROE share this form.
 */
export function DivergingBar({
  value,
  scale,
  fill,
  track = "bg-surface",
}: {
  value: number;
  scale: number;
  /** Background class of the bar. */
  fill: string;
  track?: string;
}) {
  const half = Math.min(Math.abs(value) / scale, 1) * 50;
  return (
    <span aria-hidden className={cn("relative block h-2.5 rounded-full", track)}>
      <span className="absolute -top-[3px] -bottom-[3px] left-1/2 w-[1.5px] rounded-sm bg-line-strong" />
      <span
        className={cn("absolute inset-y-0 rounded-full", fill)}
        style={
          value >= 0
            ? { left: "50%", width: `${half}%` }
            : { left: `${50 - half}%`, width: `${half}%` }
        }
      />
    </span>
  );
}

/** A scale for DivergingBar: the largest |value| rounded up to ten, at most 100. */
export function barScale(values: (number | null | undefined)[]): number {
  const max = Math.max(
    0,
    ...values.filter((v): v is number => typeof v === "number" && Number.isFinite(v)).map(Math.abs),
  );
  return Math.min(Math.max(Math.ceil(max / 10) * 10, 10), 100);
}
