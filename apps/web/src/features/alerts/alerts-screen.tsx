"use client";

import { ExternalLink, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { BackButton } from "@/components/layout/back-button";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { StateMessage } from "@/components/ui/state-message";
import { NoteBox } from "@/features/stock-detail/detail-ui";
import { cn } from "@/lib/cn";
import { formatMarketTime, formatRelativeTime } from "@/lib/format";
import { safeExternalUrl } from "@/lib/links";

import {
  type AlertEvent,
  type AlertRule,
  COOLDOWN_OPTIONS,
  cooldownLabel,
  describeRule,
} from "./alert-model";
import { AlertRuleSheet } from "./alert-rule-sheet";
import { useAlerts } from "./use-alerts";

type Tab = "events" | "rules";

function EventItem({ event, now }: { event: AlertEvent; now: Date }) {
  const { markRead, deleteEvents } = useAlerts();
  const href = safeExternalUrl(event.url);
  return (
    <li
      aria-label={event.title}
      className={cn(
        "space-y-2 rounded-[20px] border bg-surface p-3.5 shadow-soft",
        event.read ? "border-line" : "border-mint-deep/40",
      )}
    >
      <div className="flex items-start gap-2">
        {!event.read && (
          <span
            aria-label="ยังไม่อ่าน"
            className="mt-1.5 size-2 shrink-0 rounded-full bg-mint-deep"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[14.5px] font-medium text-ink">{event.title}</p>
          {event.message && (
            <p
              lang={event.type === "company_news" ? "en" : undefined}
              className="text-[12.5px] text-slate-strong"
            >
              {event.message}
            </p>
          )}
        </div>
        <button
          type="button"
          aria-label={`ลบการแจ้งเตือน ${event.title}`}
          onClick={() => void deleteEvents([event.id])}
          className="grid size-9 shrink-0 place-items-center rounded-full text-slate hover:bg-cream-deep"
        >
          <Trash2 aria-hidden className="size-4" />
        </button>
      </div>
      {event.facts.length > 0 && (
        <dl className="grid grid-cols-2 gap-1.5">
          {event.facts.map((f) => (
            <div key={f.label} className="rounded-xl bg-cream-deep px-2.5 py-1.5">
              <dt className="text-[11px] text-slate">{f.label}</dt>
              <dd className="tabular font-display text-[13px] font-extrabold text-ink">
                {f.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-slate">
        <span>
          {event.source && `ข้อมูลจาก ${event.source} · `}
          {event.dataAsOf && `ข้อมูลเวลา ${formatMarketTime(event.dataAsOf, now)} · `}
          แจ้งเมื่อ {formatRelativeTime(event.createdAt, now)}
        </span>
        <span className="flex items-center gap-3">
          {href && (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-mint-deep hover:underline"
            >
              อ่านข่าว <ExternalLink aria-hidden className="size-3.5" />
            </a>
          )}
          <Link href={`/stocks/${encodeURIComponent(event.symbol)}`} className="hover:underline">
            ดู {event.symbol}
          </Link>
          {!event.read && (
            <button
              type="button"
              onClick={() => void markRead([event.id])}
              className="min-h-8 font-medium text-ink hover:underline"
            >
              อ่านแล้ว
            </button>
          )}
        </span>
      </div>
    </li>
  );
}

function RuleItem({ rule }: { rule: AlertRule }) {
  const { updateRule, deleteRule } = useAlerts();
  const label = describeRule(rule);
  const timed = rule.type !== "earnings_upcoming" && rule.type !== "company_news";
  return (
    <li
      aria-label={label}
      className="space-y-2 rounded-[20px] border border-line bg-surface p-3.5 shadow-soft"
    >
      <div className="flex items-center gap-2">
        <p
          className={cn(
            "min-w-0 flex-1 text-[14px] font-medium",
            rule.enabled ? "text-ink" : "text-slate",
          )}
        >
          {label}
        </p>
        <button
          type="button"
          role="switch"
          aria-checked={rule.enabled}
          aria-label={`เปิดใช้ ${label}`}
          onClick={() => void updateRule({ ...rule, enabled: !rule.enabled })}
          className={cn(
            "relative h-7 w-12 shrink-0 rounded-full transition",
            rule.enabled ? "bg-mint-deep" : "bg-line-strong",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "absolute top-1 size-5 rounded-full bg-surface shadow-soft transition-all",
              rule.enabled ? "left-6" : "left-1",
            )}
          />
        </button>
      </div>
      <div className="flex items-center justify-between gap-2">
        {timed ? (
          <label className="flex items-center gap-2 text-[12px] text-slate">
            พักระหว่างแจ้ง
            <select
              value={rule.cooldownMinutes}
              onChange={(e) =>
                void updateRule({ ...rule, cooldownMinutes: Number(e.target.value) })
              }
              className="h-9 rounded-xl border border-line bg-surface px-2 text-[12.5px] text-ink"
            >
              {[...new Set([...COOLDOWN_OPTIONS, rule.cooldownMinutes])].map((m) => (
                <option key={m} value={m}>
                  {cooldownLabel(m)}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="text-[12px] text-slate">แจ้งครั้งเดียวต่อเหตุการณ์</span>
        )}
        <button
          type="button"
          onClick={() => void deleteRule(rule.id)}
          className="inline-flex min-h-9 items-center gap-1 rounded-full px-3 text-[12.5px] text-down hover:bg-accent-soft"
        >
          <Trash2 aria-hidden className="size-4" />
          ลบ
        </button>
      </div>
    </li>
  );
}

export function AlertsScreen({
  newFor = null,
  now = new Date(),
}: {
  /** Opens the new-rule sheet for this symbol (from Stock Detail). */
  newFor?: string | null;
  now?: Date;
}) {
  const alerts = useAlerts();
  const [tab, setTab] = useState<Tab>("events");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [sheet, setSheet] = useState<string | null>(newFor);
  const shown = unreadOnly ? alerts.events.filter((e) => !e.read) : alerts.events;

  return (
    <PageContainer>
      <PageHeader
        leading={<BackButton />}
        title="การแจ้งเตือน"
        trailing={
          <button
            type="button"
            aria-label="ตั้งการแจ้งเตือนใหม่"
            onClick={() => setSheet("")}
            className="grid size-11 place-items-center rounded-full bg-ink text-surface"
          >
            <Plus aria-hidden className="size-5" strokeWidth={2.4} />
          </button>
        }
      />
      <main className="pb-nav space-y-3.5 px-4">
        <SegmentedControl
          label="มุมมอง"
          options={[
            {
              value: "events",
              label: `แจ้งเตือน${alerts.unread > 0 ? ` (${alerts.unread})` : ""}`,
            },
            { value: "rules", label: `กฎ (${alerts.rules.length})` },
          ]}
          value={tab}
          onChange={setTab}
        />
        {alerts.notice && (
          <p role="status" className="rounded-2xl bg-honey px-3.5 py-2.5 text-xs text-honey-ink">
            {alerts.notice}
          </p>
        )}

        {!alerts.ready ? null : tab === "events" ? (
          <section aria-label="การแจ้งเตือน" className="space-y-2.5">
            {alerts.events.length > 0 && (
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-[13px] text-slate-strong">
                  <input
                    type="checkbox"
                    checked={unreadOnly}
                    onChange={(e) => setUnreadOnly(e.target.checked)}
                    className="size-4 accent-ink"
                  />
                  เฉพาะที่ยังไม่อ่าน
                </label>
                {alerts.unread > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      void alerts.markRead(alerts.events.filter((e) => !e.read).map((e) => e.id))
                    }
                    className="min-h-9 text-[13px] font-medium text-ink hover:underline"
                  >
                    อ่านทั้งหมด
                  </button>
                )}
              </div>
            )}
            {shown.length === 0 ? (
              <StateMessage
                title={alerts.events.length === 0 ? "ยังไม่มีการแจ้งเตือน" : "อ่านครบทุกรายการแล้ว"}
                description={
                  alerts.rules.length === 0
                    ? "ตั้งการแจ้งเตือนราคา วันประกาศงบ หรือข่าวของหุ้นที่สนใจได้จากปุ่ม +"
                    : undefined
                }
              />
            ) : (
              <ul className="space-y-2.5">
                {shown.map((e) => (
                  <EventItem key={e.id} event={e} now={now} />
                ))}
              </ul>
            )}
          </section>
        ) : (
          <section aria-label="กฎการแจ้งเตือน" className="space-y-2.5">
            {alerts.rules.length === 0 ? (
              <StateMessage
                title="ยังไม่ได้ตั้งการแจ้งเตือน"
                action={
                  <button
                    type="button"
                    onClick={() => setSheet("")}
                    className="min-h-11 rounded-full bg-ink px-5 text-sm font-medium text-surface"
                  >
                    ตั้งการแจ้งเตือน
                  </button>
                }
              />
            ) : (
              <ul className="space-y-2.5">
                {alerts.rules.map((r) => (
                  <RuleItem key={r.id} rule={r} />
                ))}
              </ul>
            )}
          </section>
        )}

        <NoteBox icon>
          การแจ้งเตือนทำงานขณะเปิด Mallowtick อยู่เท่านั้น โดยตรวจกับข้อมูลที่แอปโหลดมา (ราคาทุก 5
          นาที ปฏิทินงบและข่าวทุก 30 นาที) ไม่มีการแจ้งเตือนเบื้องหลังบน iPhone
          และไม่ใช้ราคาเก่าหรือราคาที่โหลดไม่สำเร็จ กฎและประวัติเก็บไว้ในเครื่องนี้เท่านั้น
          ไม่ส่งขึ้นเซิร์ฟเวอร์ ไม่ใช่คำแนะนำการลงทุน
        </NoteBox>
      </main>
      {sheet !== null && <AlertRuleSheet initialSymbol={sheet} onClose={() => setSheet(null)} />}
    </PageContainer>
  );
}
