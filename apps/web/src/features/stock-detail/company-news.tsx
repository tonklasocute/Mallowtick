"use client";

import { ArrowUpRight, ChevronDown, Newspaper } from "lucide-react";
import { useId, useState } from "react";

import { ApiErrorState } from "@/components/market/api-error-state";
import { StateMessage } from "@/components/ui/state-message";
import { Skeleton } from "@/components/ui/skeleton";
import { useInView } from "@/hooks/use-in-view";
import { cn } from "@/lib/cn";
import { formatMarketTime } from "@/lib/format";
import { isApiError } from "@/services/api/client";
import { useNews } from "@/services/api/queries";
import type { NewsArticle } from "@/types/api";

import { CardBadge, CardHeading, DetailCard, SourceNote } from "./detail-ui";

const TITLE = "ข่าวล่าสุด";

/** Articles shown before "ดูข่าวเพิ่ม"; the API sends up to 10. */
const FIRST_ARTICLES = 5;

function Heading() {
  return (
    <CardHeading
      icon={Newspaper}
      tone="sky"
      title={TITLE}
      badge={<CardBadge tone="soft">7 วันล่าสุด</CardBadge>}
    />
  );
}

/** One headline linking out to the article in a new tab. */
function ArticleRow({ article }: { article: NewsArticle }) {
  return (
    <li>
      <a
        href={article.url}
        target="_blank"
        rel="noopener noreferrer"
        className="group flex items-start gap-3 py-3"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span
            lang="en"
            className="line-clamp-3 text-[14px] leading-snug font-bold text-ink group-hover:text-up"
          >
            {article.headline}
          </span>
          <span className="flex flex-wrap items-center gap-x-1.5 text-[11.5px] text-slate">
            {article.source && (
              <>
                <span lang="en" className="font-bold text-slate-strong">
                  {article.source}
                </span>
                <span aria-hidden>·</span>
              </>
            )}
            <time dateTime={article.publishedAt} className="tabular">
              {formatMarketTime(article.publishedAt)}
            </time>
          </span>
        </span>
        <ArrowUpRight
          aria-hidden
          className="mt-0.5 size-4 shrink-0 text-slate group-hover:text-up"
          strokeWidth={2.4}
        />
        <span className="sr-only"> (เปิดในแท็บใหม่)</span>
      </a>
    </li>
  );
}

/**
 * The past week's headlines about the company, newest first, each opening the article
 * in a new tab. Fetched once the card is near the screen: it sits at the end of the page
 * and each symbol costs a Finnhub call per 30 minutes. Renders nothing without a news
 * vendor (the company card says what to configure).
 */
export function CompanyNews({ symbol }: { symbol: string }) {
  const [ref, inView] = useInView<HTMLElement>();
  const { data, error, isPending, refetch } = useNews(symbol, inView);
  const [expanded, setExpanded] = useState(false);
  const listId = useId();

  if (isPending) {
    return (
      <DetailCard ref={ref} aria-label={TITLE}>
        <Heading />
        <div aria-busy="true" aria-label="กำลังโหลดข่าวล่าสุด" className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </DetailCard>
    );
  }
  if (!data) {
    if (isApiError(error) && error.code === "provider_not_configured") return null;
    return (
      <DetailCard ref={ref} aria-label={TITLE}>
        <Heading />
        <ApiErrorState error={error} onRetry={() => void refetch()} compact />
      </DetailCard>
    );
  }

  const { articles } = data;
  const shown = expanded ? articles : articles.slice(0, FIRST_ARTICLES);
  const more = articles.length - FIRST_ARTICLES;

  return (
    <DetailCard ref={ref} aria-label={TITLE}>
      <Heading />
      {articles.length === 0 ? (
        <StateMessage compact title="ยังไม่มีข่าวในสัปดาห์นี้" />
      ) : (
        <>
          <ul id={listId} className="-my-3 divide-y divide-dashed divide-line">
            {shown.map((a) => (
              <ArticleRow key={a.url} article={a} />
            ))}
          </ul>
          {more > 0 && (
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={listId}
              onClick={() => setExpanded((e) => !e)}
              className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full bg-cream-deep text-[13px] font-medium text-slate-strong hover:text-ink"
            >
              {expanded ? "แสดงน้อยลง" : `ดูข่าวเพิ่มอีก ${more} ข่าว`}
              <ChevronDown
                aria-hidden
                className={cn("size-4 transition-transform", expanded && "rotate-180")}
                strokeWidth={2.4}
              />
            </button>
          )}
        </>
      )}
      <SourceNote freshness={data.freshness}>
        หัวข้อข่าวเป็นภาษาอังกฤษตามต้นฉบับจากผู้ให้บริการ แตะเพื่ออ่านต่อที่เว็บไซต์ต้นทาง
        ไม่ใช่ความเห็นของ Mallowtick
      </SourceNote>
    </DetailCard>
  );
}
