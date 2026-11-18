"use client";

import { ChevronRight, Database, Download, Info, Smartphone, Wrench } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";

import { Mascot } from "@/components/brand/mascot";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { errorCopy } from "@/components/market/api-error-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useStorageDescription } from "@/features/watchlist/use-watchlist";
import { BRAND } from "@/lib/brand";
import { vendorLabel } from "@/lib/providers";
import { useHealth } from "@/services/api/queries";
import type { DataKind, Latency } from "@/types/api";

const LATENCY_COPY: Record<Latency, string> = {
  realtime: "เรียลไทม์ (ตามที่ระบุไว้สำหรับแพ็กเกจที่ตั้งค่า)",
  delayed: "ล่าช้า",
  eod: "ราคาปิดสิ้นวัน",
  unknown: "ไม่ได้ระบุ — ราคาจะแสดงพร้อมเวลาของข้อมูลเท่านั้น",
};

/** Short labels for a source's row when vendors declare different latencies. */
const LATENCY_SHORT: Record<Latency, string> = {
  realtime: "เรียลไทม์",
  delayed: "ล่าช้า",
  eod: "สิ้นวัน",
  unknown: "ไม่ระบุความล่าช้า",
};

function subscribeDisplayMode(onChange: () => void) {
  const mq = window.matchMedia("(display-mode: standalone)");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function useIsStandalone(): boolean {
  return useSyncExternalStore(
    subscribeDisplayMode,
    () =>
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
    () => false,
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <div className="mb-2 flex items-center gap-2 text-mint-deep">
        {icon}
        <CardTitle>{title}</CardTitle>
      </div>
      <div className="space-y-2 text-sm text-slate-strong">{children}</div>
    </Card>
  );
}

/** The research and alert screens, which have no tab of their own. */
const TOOL_LINKS: [string, string, string][] = [
  ["/briefing", "สรุปตลาดวันนี้", "ข้อสังเกตจากข้อมูลของหุ้นที่คุณติดตาม"],
  ["/earnings", "ปฏิทินประกาศงบ", "วันประกาศงบและผลเทียบประมาณการ"],
  ["/news", "ข่าว", "ข่าวของหุ้นในพอร์ตและรายการที่สนใจ"],
  ["/alerts", "การแจ้งเตือน", "แจ้งเมื่อราคา วันประกาศงบ หรือข่าวเข้าเงื่อนไข"],
  ["/compare", "เปรียบเทียบหุ้น", "ตัวเลขสำคัญเทียบกันสูงสุด 4 ตัว"],
];

/** Rows of the data-source list, in display order. */
const SOURCE_ROWS: [DataKind, string][] = [
  ["quotes", "ราคาล่าสุด"],
  ["search", "ค้นหาหุ้น"],
  ["candles", "กราฟแท่งเทียน"],
  ["status", "สถานะตลาด"],
  ["earnings", "วันประกาศงบ"],
  ["fundamentals", "ข้อมูลบริษัท"],
  ["fx", "อัตราแลกเปลี่ยน"],
  ["news", "ข่าว"],
];

/** "ข้อมูลตลาดโดย Finnhub และ Twelve Data" from the vendors actually in use. */
function DataCredit() {
  const { data } = useHealth();
  const names = [
    ...new Set(Object.values(data?.provider.sources ?? {}).map((s) => vendorLabel(s.name))),
  ];
  if (names.length === 0) return null;
  return <>ข้อมูลตลาดโดย {names.join(" และ ")}</>;
}

function ProviderStatus() {
  const { data, error, isPending } = useHealth();
  if (isPending) return <Skeleton className="h-10 w-full" />;
  if (!data) return <p>{errorCopy(error).title}</p>;
  const { provider } = data;
  const sources = SOURCE_ROWS.flatMap(([kind, label]) => {
    const s = provider.sources?.[kind];
    return s ? [{ kind, label, ...s, latency: s.latency ?? provider.latency }] : [];
  });
  // One declaration for every vendor reads as before; different ones go on each row.
  const latencies = new Set(sources.map((s) => s.latency));
  const mixed = latencies.size > 1;
  return (
    <dl className="space-y-1.5">
      {sources.length > 0 ? (
        sources.map((s) => (
          <div key={s.kind} className="flex justify-between gap-3">
            <dt>{s.label}</dt>
            <dd className="inline-flex items-center gap-1.5 font-semibold text-ink">
              {vendorLabel(s.name)}
              {mixed && <Badge tone="sky">{LATENCY_SHORT[s.latency]}</Badge>}
              {!s.configured && <Badge tone="accent">ยังไม่ได้ตั้งค่า</Badge>}
            </dd>
          </div>
        ))
      ) : (
        <div className="flex justify-between gap-3">
          <dt>ผู้ให้บริการ</dt>
          <dd className="font-semibold text-ink">{vendorLabel(provider.name)}</dd>
        </div>
      )}
      <div className="flex justify-between gap-3">
        <dt>สถานะ</dt>
        <dd>
          {provider.configured ? (
            <Badge tone="mint">ตั้งค่าแล้ว</Badge>
          ) : (
            <Badge tone="accent">ยังไม่ได้ตั้งค่า</Badge>
          )}
        </dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt>ความล่าช้าของข้อมูล</dt>
        <dd className="text-right font-semibold text-ink">
          {mixed
            ? "แตกต่างกันตามแหล่งข้อมูล (ดูด้านบน)"
            : LATENCY_COPY[sources[0]?.latency ?? provider.latency]}
        </dd>
      </div>
    </dl>
  );
}

export function MoreScreen() {
  const storage = useStorageDescription();
  const standalone = useIsStandalone();
  return (
    <PageContainer>
      <PageHeader title="เพิ่มเติม" />
      <main className="pb-nav space-y-4 px-4">
        <Section icon={<Database aria-hidden className="size-5" />} title="ข้อมูลตลาด">
          <ProviderStatus />
          <p className="text-xs text-slate">
            ราคาจะอัปเดตอัตโนมัติขณะเปิดหน้าจออยู่ ทุกราคาแสดงเวลาจากผู้ให้บริการ
            ข้อมูลที่แคชไว้หรือขณะออฟไลน์จะถูกระบุว่าเป็นข้อมูลเก่า และจะไม่แสดงเป็นราคาล่าสุด
          </p>
        </Section>

        <Section icon={<Wrench aria-hidden className="size-5" />} title="เครื่องมือ">
          <ul className="-my-1 divide-y divide-line">
            {TOOL_LINKS.map(([href, label, hint]) => (
              <li key={href}>
                <Link href={href} className="flex min-h-12 items-center gap-2 py-1.5">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-ink">{label}</span>
                    <span className="block text-xs text-slate">{hint}</span>
                  </span>
                  <ChevronRight aria-hidden className="size-4 text-slate" />
                </Link>
              </li>
            ))}
          </ul>
        </Section>

        <Section
          icon={<Smartphone aria-hidden className="size-5" />}
          title="ที่เก็บรายการหุ้นที่สนใจ"
        >
          {storage ? <p>{storage}</p> : <Skeleton className="h-10 w-full" />}
        </Section>

        <Section icon={<Download aria-hidden className="size-5" />} title="ติดตั้งบน iPhone">
          {standalone ? (
            <p>ติดตั้ง Mallowtick บนอุปกรณ์นี้แล้ว 🎉</p>
          ) : (
            <ol className="list-decimal space-y-1 pl-5">
              <li>เปิด Mallowtick ใน Safari</li>
              <li>แตะปุ่มแชร์</li>
              <li>เลือก “เพิ่มไปยังหน้าจอโฮม”</li>
            </ol>
          )}
        </Section>

        <Section icon={<Info aria-hidden className="size-5" />} title="เกี่ยวกับ">
          <div className="flex items-center gap-3">
            <Mascot size={44} />
            <div>
              <p className="font-display font-semibold text-ink">{BRAND.name}</p>
              <p className="text-xs">{BRAND.tagline}</p>
            </div>
          </div>
          <p className="text-xs text-slate">
            ใช้เป็นข้อมูลประกอบเท่านั้น ไม่ใช่คำแนะนำการลงทุน
            แนวรับและแนวต้านเป็นค่าประมาณจากการคำนวณ และไม่ได้คาดการณ์ราคาในอนาคต <DataCredit />
          </p>
          {/* Attribution notice required by the Lightweight Charts licence (the chart shows no logo). */}
          <p className="text-xs text-slate">
            กราฟโดย TradingView Lightweight Charts™
            <br />
            Copyright (с) 2025 TradingView, Inc.{" "}
            <a
              href="https://www.tradingview.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-mint-deep underline underline-offset-2"
            >
              https://www.tradingview.com/
            </a>
          </p>
        </Section>
      </main>
    </PageContainer>
  );
}
