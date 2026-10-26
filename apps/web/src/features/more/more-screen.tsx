"use client";

import { Download, Info, Database, Smartphone } from "lucide-react";
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
import { useHealth } from "@/services/api/queries";
import type { Latency } from "@/types/api";

const LATENCY_COPY: Record<Latency, string> = {
  realtime: "เรียลไทม์ (ตามที่ระบุไว้สำหรับแพ็กเกจที่ตั้งค่า)",
  delayed: "ล่าช้า",
  eod: "ราคาปิดสิ้นวัน",
  unknown: "ไม่ได้ระบุ — ราคาจะแสดงพร้อมเวลาของข้อมูลเท่านั้น",
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

function ProviderStatus() {
  const { data, error, isPending } = useHealth();
  if (isPending) return <Skeleton className="h-10 w-full" />;
  if (!data) return <p>{errorCopy(error).title}</p>;
  const { provider } = data;
  return (
    <dl className="space-y-1.5">
      <div className="flex justify-between gap-3">
        <dt>ผู้ให้บริการ</dt>
        <dd className="font-semibold text-ink">
          {provider.name === "twelvedata" ? "Twelve Data" : provider.name}
        </dd>
      </div>
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
        <dd className="text-right font-semibold text-ink">{LATENCY_COPY[provider.latency]}</dd>
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
            แนวรับและแนวต้านเป็นค่าประมาณจากการคำนวณ และไม่ได้คาดการณ์ราคาในอนาคต ข้อมูลตลาดโดย
            Twelve Data
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
