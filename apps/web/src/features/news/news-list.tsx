"use client";

import { ApiErrorState } from "@/components/market/api-error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { StateMessage } from "@/components/ui/state-message";
import { NoteBox, SourceNote } from "@/features/stock-detail/detail-ui";
import { unavailableReasonLabel } from "@/lib/unavailable-reason";
import { useNews } from "@/services/api/queries";
import type { MarketNewsCategory } from "@/types/api";

import { NewsCard } from "./news-card";

/**
 * Grouped news for symbols (company news) or a market category, a page at a time, with the
 * loading, error, empty and "still loading some symbols" states.
 */
export function NewsList({
  symbols,
  category,
  emptyTitle = "ยังไม่มีข่าวในช่วงนี้",
  limit,
  now,
}: {
  symbols?: string[];
  category?: MarketNewsCategory;
  emptyTitle?: string;
  limit?: number;
  now?: Date;
}) {
  const news = useNews({ symbols, category, limit });
  const pages = news.data?.pages ?? [];
  const articles = pages.flatMap((p) => p.articles);
  const first = pages[0];

  if (news.isPending) {
    return (
      <div aria-busy="true" aria-label="กำลังโหลดข่าว" className="space-y-2.5">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-32 w-full rounded-[20px]" />
        ))}
      </div>
    );
  }
  if (!first) return <ApiErrorState error={news.error} onRetry={() => void news.refetch()} />;

  const waiting = first.unavailable;
  return (
    <div className="space-y-2.5">
      {waiting.length > 0 && (
        <p role="status" className="rounded-2xl bg-honey px-3.5 py-2.5 text-xs text-honey-ink">
          ยังไม่มีข่าวของ {waiting.map((u) => u.symbol).join(", ")} (
          {unavailableReasonLabel(waiting[0]!.reason)}) จะโหลดเพิ่มให้อัตโนมัติ
        </p>
      )}
      {articles.length === 0 ? (
        <StateMessage title={emptyTitle} />
      ) : (
        articles.map((a) => <NewsCard key={a.id} article={a} now={now} />)
      )}
      {news.hasNextPage && (
        <button
          type="button"
          disabled={news.isFetchingNextPage}
          onClick={() => void news.fetchNextPage()}
          className="min-h-11 w-full rounded-full border border-line bg-surface text-sm font-medium text-ink hover:border-line-strong disabled:opacity-50"
        >
          {news.isFetchingNextPage
            ? "กำลังโหลด…"
            : `โหลดข่าวเพิ่ม (${first.total - articles.length} ข่าว)`}
        </button>
      )}
      <NoteBox icon>
        ข่าวแสดงตามที่ผู้ให้บริการส่งมา เป็นภาษาต้นฉบับ Mallowtick ไม่ได้เขียนหรือแก้ไขเนื้อหา
        และไม่ได้สรุปว่าข่าวใดทำให้ราคาเปลี่ยน ข่าวเดียวกันจากหลายแหล่งรวมไว้เป็นข่าวเดียว
      </NoteBox>
      <SourceNote freshness={first.freshness} />
    </div>
  );
}
