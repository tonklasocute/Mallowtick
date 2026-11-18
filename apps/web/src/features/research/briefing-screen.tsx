"use client";

import { Scale } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

import { BackButton } from "@/components/layout/back-button";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { ApiErrorState } from "@/components/market/api-error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { StateMessage } from "@/components/ui/state-message";
import { valuePortfolio } from "@/features/portfolio/portfolio-model";
import { usePortfolio } from "@/features/portfolio/use-portfolio";
import { NoteBox } from "@/features/stock-detail/detail-ui";
import { useMySymbols } from "@/hooks/use-my-symbols";
import { formatMarketTime } from "@/lib/format";
import { concentrationInsights, coverageLines, isFilling } from "@/lib/research";
import { BRIEFING_MAX_SYMBOLS, useBriefing, useQuotes } from "@/services/api/queries";
import type { Insight, Quote } from "@/types/api";

import { InsightCard } from "./insight-card";

function Section({
  title,
  insights,
  empty,
  now,
}: {
  title: string;
  insights: Insight[];
  empty?: string;
  now?: Date;
}) {
  if (insights.length === 0 && !empty) return null;
  return (
    <section aria-label={title} className="space-y-2.5">
      <h2 className="px-1 text-[17px] font-medium text-ink">{title}</h2>
      {insights.length === 0 ? (
        <p className="rounded-2xl bg-cream-deep px-3.5 py-3 text-[13px] text-slate">{empty}</p>
      ) : (
        insights.map((i) => <InsightCard key={i.id} insight={i} now={now} />)
      )}
    </section>
  );
}

export function BriefingScreen({ now }: { now?: Date }) {
  const mine = useMySymbols();
  const symbols = mine.all.slice(0, BRIEFING_MAX_SYMBOLS);
  const briefing = useBriefing(symbols, !mine.isLoading);
  const { portfolio } = usePortfolio();
  // The portfolio's quotes are shared with the portfolio screen; nothing about holdings is sent.
  const quotes = useQuotes(mine.holdings);
  const concentration = useMemo(() => {
    const bySymbol = new Map<string, Quote>(quotes.data?.quotes.map((q) => [q.symbol, q]));
    return concentrationInsights(
      valuePortfolio({ ...portfolio, currency: "USD" }, bySymbol, null),
      now ?? new Date(),
    );
  }, [quotes.data, portfolio, now]);

  const b = briefing.data;
  const held = new Set(mine.holdings);
  const forHoldings = (b?.insights ?? []).filter((i) => i.symbol && held.has(i.symbol));
  const forWatchlist = (b?.insights ?? []).filter((i) => i.symbol && !held.has(i.symbol));
  const gaps = b ? coverageLines(b.coverage) : [];

  return (
    <PageContainer>
      <PageHeader
        leading={<BackButton />}
        title="สรุปตลาดวันนี้"
        trailing={
          <Link
            href="/compare"
            aria-label="เปรียบเทียบหุ้น"
            title="เปรียบเทียบหุ้น"
            className="grid size-11 place-items-center rounded-full border border-line bg-surface text-ink hover:bg-cream-deep"
          >
            <Scale aria-hidden className="size-5" />
          </Link>
        }
      />
      <main className="pb-nav space-y-5 px-4">
        {briefing.isPending ? (
          <div aria-busy="true" aria-label="กำลังสรุปข้อมูล" className="space-y-2.5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-32 w-full rounded-[20px]" />
            ))}
          </div>
        ) : !b ? (
          <ApiErrorState error={briefing.error} onRetry={() => void briefing.refetch()} />
        ) : (
          <>
            <p className="px-1 text-[12px] font-light text-slate">
              สรุปเมื่อ {formatMarketTime(b.generatedAt, now)} · วันที่ตลาดสหรัฐฯ {b.today}
            </p>
            <Section
              title="ภาพรวมตลาด"
              insights={b.market}
              empty="ยังไม่มีข้อมูลภาพรวมตลาด"
              now={now}
            />
            {symbols.length === 0 ? (
              <StateMessage
                title="ยังไม่มีหุ้นของคุณในสรุป"
                description="เพิ่มหุ้นในพอร์ตหรือรายการที่สนใจ แล้วสรุปจะรวมข้อสังเกตของหุ้นเหล่านั้น"
              />
            ) : (
              <>
                <Section
                  title="สิ่งที่ควรจับตา"
                  insights={b.thingsToWatch}
                  empty="วันนี้ยังไม่มีข้อสังเกตที่เข้าเกณฑ์สำหรับหุ้นของคุณ"
                  now={now}
                />
                {mine.holdings.length > 0 && (
                  <Section
                    title="พอร์ตของฉัน"
                    insights={[...concentration, ...forHoldings]}
                    empty="ไม่มีข้อสังเกตสำหรับหุ้นในพอร์ต"
                    now={now}
                  />
                )}
                {forWatchlist.length > 0 && (
                  <Section title="หุ้นที่สนใจ" insights={forWatchlist} now={now} />
                )}
                {mine.all.length > BRIEFING_MAX_SYMBOLS && (
                  <p className="px-1 text-[12px] text-slate">
                    สรุปครอบคลุม {BRIEFING_MAX_SYMBOLS} ตัวแรก (หุ้นในพอร์ตก่อน
                    แล้วตามรายการที่สนใจ)
                  </p>
                )}
              </>
            )}
            {gaps.length > 0 && (
              <div
                role="status"
                className="space-y-1 rounded-2xl bg-honey px-3.5 py-2.5 text-xs text-honey-ink"
              >
                <p>
                  ข้อมูลบางส่วนยังไม่ครบ
                  {isFilling(b.coverage) &&
                    " กำลังโหลดเพิ่มทีละน้อยเพื่อไม่ให้เกินโควตาผู้ให้บริการ"}
                </p>
                <ul className="list-inside list-disc">
                  {gaps.map((g) => (
                    <li key={g}>{g}</li>
                  ))}
                </ul>
              </div>
            )}
            <NoteBox icon>{b.disclaimer}</NoteBox>
          </>
        )}
      </main>
    </PageContainer>
  );
}
