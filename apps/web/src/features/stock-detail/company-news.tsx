"use client";

import { ChevronRight, Newspaper } from "lucide-react";
import Link from "next/link";

import { ApiErrorState } from "@/components/market/api-error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { NewsCard } from "@/features/news/news-card";
import { isApiError } from "@/services/api/client";
import { useNews } from "@/services/api/queries";

import { CardHeading, DetailCard, SourceNote } from "./detail-ui";

/** How many stories Stock Detail shows; the rest are on the news screen. */
const SHOWN = 5;

/**
 * The company's latest news from the vendor, as published. Renders nothing when no vendor
 * publishes news. One cached call per symbol every 30 minutes, shared with the news screen.
 */
export function CompanyNews({ symbol, now }: { symbol: string; now?: Date }) {
  const { data, error, isPending, refetch } = useNews({ symbols: [symbol], limit: SHOWN });
  const page = data?.pages[0];

  if (!page && isApiError(error) && error.code === "provider_not_configured") return null;
  return (
    <DetailCard aria-label="ข่าวล่าสุด">
      <CardHeading icon={Newspaper} tone="sky" title="ข่าวล่าสุด" />
      {isPending ? (
        <div aria-busy="true" aria-label="กำลังโหลดข่าว" className="space-y-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-[20px]" />
          ))}
        </div>
      ) : !page ? (
        <ApiErrorState error={error} onRetry={() => void refetch()} compact />
      ) : page.articles.length === 0 ? (
        <p className="text-[13px] text-slate">ยังไม่มีข่าวของ {symbol} ใน 7 วันที่ผ่านมา</p>
      ) : (
        <>
          <div className="space-y-2">
            {page.articles.map((a) => (
              <NewsCard key={a.id} article={a} now={now} />
            ))}
          </div>
          {page.total > page.articles.length && (
            <Link
              href={`/news?symbol=${encodeURIComponent(symbol)}`}
              className="inline-flex min-h-10 items-center justify-center gap-1 rounded-full border border-line text-[13px] font-medium text-ink hover:border-line-strong"
            >
              ดูข่าวทั้งหมดของ {symbol} ({page.total})
              <ChevronRight aria-hidden className="size-4" />
            </Link>
          )}
          <SourceNote freshness={page.freshness}>
            ข่าวภาษาต้นฉบับ ไม่ได้บอกว่าข่าวใดทำให้ราคาเปลี่ยน
          </SourceNote>
        </>
      )}
    </DetailCard>
  );
}
