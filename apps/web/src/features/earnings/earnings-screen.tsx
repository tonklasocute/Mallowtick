"use client";

import { CalendarDays, Search } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { BackButton } from "@/components/layout/back-button";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { ApiErrorState } from "@/components/market/api-error-state";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { StateMessage } from "@/components/ui/state-message";
import { NoteBox, SourceNote } from "@/features/stock-detail/detail-ui";
import { useMySymbols } from "@/hooks/use-my-symbols";
import { cn } from "@/lib/cn";
import {
  calendarWindow,
  firstEvents,
  groupByDate,
  HOUR_THAI_HINTS,
  REPORTING_CURRENCY_NOTE,
  HOUR_LABELS,
  marketToday,
  matchesQuery,
  type CalendarTab,
} from "@/lib/earnings";
import { useEarningsCalendar } from "@/services/api/queries";

import { EarningsEventCard } from "./earnings-event-card";

const TABS = [
  { value: "today", label: "วันนี้" },
  { value: "upcoming", label: "กำลังจะมาถึง" },
  { value: "past", label: "ประกาศแล้ว" },
] as const satisfies readonly { value: CalendarTab; label: string }[];

/** Cards rendered per page; a busy day has several hundred reports. */
const PAGE = 30;

/** "พฤหัสบดี 19 พ.ย." from a YYYY-MM-DD New York date. */
function dayLabel(date: string, today: string): string {
  const label = new Date(`${date}T00:00:00Z`).toLocaleDateString("th-TH-u-ca-gregory", {
    weekday: "long",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  return date === today ? `วันนี้ · ${label}` : label;
}

/** Short chip label: "19 พ.ย.". */
function chipLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("th-TH-u-ca-gregory", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function Chip({
  selected,
  onClick,
  children,
  disabled,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "min-h-9 shrink-0 rounded-full border px-3 text-[12.5px] whitespace-nowrap transition disabled:opacity-40",
        selected
          ? "border-ink bg-ink font-medium text-surface"
          : "border-line bg-surface text-slate-strong hover:border-line-strong",
      )}
    >
      {children}
    </button>
  );
}

export function EarningsScreen({ now = new Date() }: { now?: Date }) {
  const today = marketToday(now);
  const [tab, setTab] = useState<CalendarTab>("today");
  const [query, setQuery] = useState("");
  const [onlyMine, setOnlyMine] = useState(false);
  const [day, setDay] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const mine = useMySymbols();
  const { from, to } = calendarWindow(tab, today);
  // "Only mine" asks the API for those symbols only: a far smaller response.
  const filter = onlyMine ? mine.all : [];
  const calendar = useEarningsCalendar(from, to, filter, !onlyMine || mine.all.length > 0);

  const groups = useMemo(() => {
    const events = (calendar.data?.events ?? []).filter(
      (e) => e.date >= from && e.date <= to && matchesQuery(e, query),
    );
    return groupByDate(events, mine.set, tab === "past");
  }, [calendar.data, from, to, query, mine.set, tab]);

  const visibleGroups = day ? groups.filter((g) => g.date === day) : groups;
  const total = visibleGroups.reduce((n, g) => n + g.events.length, 0);

  const paged = firstEvents(visibleGroups, shown);

  const selectTab = (t: CalendarTab) => {
    setTab(t);
    setDay(null);
    setShown(PAGE);
  };

  return (
    <PageContainer>
      <PageHeader leading={<BackButton />} title="ปฏิทินประกาศงบ" />
      <main className="pb-nav space-y-3.5 px-4">
        <SegmentedControl label="ช่วงเวลา" options={TABS} value={tab} onChange={selectTab} />

        <div className="space-y-2.5">
          <label className="flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface px-4 focus-within:border-ink">
            <Search aria-hidden className="size-4 text-slate" />
            <span className="sr-only">ค้นหาหุ้นในปฏิทิน</span>
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setShown(PAGE);
              }}
              placeholder="ค้นหาด้วยสัญลักษณ์ เช่น NVDA"
              autoCapitalize="characters"
              className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-faint"
            />
          </label>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            <Chip
              selected={onlyMine}
              disabled={mine.all.length === 0}
              onClick={() => {
                setOnlyMine((v) => !v);
                setShown(PAGE);
              }}
            >
              เฉพาะหุ้นของฉัน{mine.all.length > 0 && ` (${mine.all.length})`}
            </Chip>
            {tab !== "today" && (
              <>
                <Chip selected={day === null} onClick={() => setDay(null)}>
                  ทุกวัน
                </Chip>
                {groups.map((g) => (
                  <Chip key={g.date} selected={day === g.date} onClick={() => setDay(g.date)}>
                    {chipLabel(g.date)} · {g.events.length}
                  </Chip>
                ))}
              </>
            )}
          </div>
        </div>

        {calendar.isPending && !calendar.data ? (
          <div aria-busy="true" aria-label="กำลังโหลดปฏิทินประกาศงบ" className="space-y-2.5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-36 w-full rounded-[20px]" />
            ))}
          </div>
        ) : !calendar.data ? (
          <ApiErrorState error={calendar.error} onRetry={() => void calendar.refetch()} />
        ) : total === 0 ? (
          <StateMessage
            title={query || onlyMine ? "ไม่พบหุ้นที่ตรงกับตัวกรอง" : "ไม่มีบริษัทประกาศงบในช่วงนี้"}
            description={
              onlyMine
                ? "หุ้นในพอร์ตและรายการที่สนใจไม่มีกำหนดประกาศงบในช่วงนี้"
                : "ลองเปลี่ยนช่วงเวลาหรือคำค้นหา"
            }
          />
        ) : (
          <>
            {paged.map((g) => (
              <section key={g.date} aria-label={dayLabel(g.date, today)} className="space-y-2">
                <h2 className="flex items-center gap-2 pt-1 text-[15px] font-medium text-ink">
                  <CalendarDays aria-hidden className="size-4 text-lavender-ink" />
                  {dayLabel(g.date, today)}
                  <span className="text-[12px] font-light text-slate">
                    {visibleGroups.find((v) => v.date === g.date)?.events.length} บริษัท
                  </span>
                </h2>
                {g.events.map((e) => (
                  <EarningsEventCard
                    key={e.symbol}
                    event={e}
                    mine={mine.set.has(e.symbol)}
                    today={today}
                  />
                ))}
              </section>
            ))}
            {shown < total && (
              <button
                type="button"
                onClick={() => setShown((n) => n + PAGE)}
                className="min-h-11 w-full rounded-full border border-line bg-surface text-sm font-medium text-ink hover:border-line-strong"
              >
                แสดงเพิ่ม ({total - shown} บริษัท)
              </button>
            )}
          </>
        )}

        {calendar.data && (
          <div className="space-y-2">
            {calendar.data.truncated && (
              <NoteBox icon>
                ช่วงนี้มีบริษัทประกาศงบมากเกินกว่าที่ผู้ให้บริการส่งมาในครั้งเดียว
                บางบริษัทอาจไม่ปรากฏในรายการ
              </NoteBox>
            )}
            <SourceNote freshness={calendar.data.freshness}>
              วันที่เป็นเวลาสหรัฐฯ ({HOUR_LABELS.amc} = {HOUR_THAI_HINTS.amc}, {HOUR_LABELS.bmo} ={" "}
              {HOUR_THAI_HINTS.bmo}) · เรียงหุ้นของฉันก่อน แล้วตามรายได้ที่นักวิเคราะห์คาด ·
              ชื่อบริษัทแสดงเฉพาะที่เคยโหลดไว้แล้ว · {REPORTING_CURRENCY_NOTE}
            </SourceNote>
          </div>
        )}
      </main>
    </PageContainer>
  );
}
