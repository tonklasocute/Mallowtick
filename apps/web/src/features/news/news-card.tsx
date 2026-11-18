import { ExternalLink } from "lucide-react";
import Link from "next/link";

import { formatMarketTime, formatRelativeTime } from "@/lib/format";
import { safeExternalUrl } from "@/lib/links";
import type { NewsArticle } from "@/types/api";

/** Thai names for the vendor's categories; others are shown as the vendor wrote them. */
const CATEGORY_LABELS: Record<string, string> = {
  company: "ข่าวบริษัท",
  general: "ข่าวตลาด",
  "top news": "ข่าวเด่น",
  business: "ธุรกิจ",
  merger: "ควบรวมกิจการ",
};

export const publisherName = (source: string) => source || "ไม่ระบุแหล่งข่าว";

/**
 * A story as the vendor published it. The headline and summary stay in their original
 * language; the link opens the publisher's page. Other publishers of the same story are
 * credited below it.
 */
export function NewsCard({ article, now = new Date() }: { article: NewsArticle; now?: Date }) {
  const href = safeExternalUrl(article.url);
  const others = article.sources.slice(1);
  return (
    <article
      aria-label={article.headline}
      className="space-y-2 rounded-[20px] border border-line bg-surface p-3.5 shadow-soft"
    >
      <p className="flex flex-wrap items-center gap-x-1.5 text-[11.5px] text-slate">
        <span className="font-medium text-slate-strong">{publisherName(article.source)}</span>
        <span aria-hidden>·</span>
        <time dateTime={article.publishedAt} title={formatMarketTime(article.publishedAt, now)}>
          {formatRelativeTime(article.publishedAt, now)}
        </time>
        {article.category && (
          <span className="rounded-full bg-cream-deep px-2 py-px text-[10.5px]">
            {CATEGORY_LABELS[article.category] ?? article.category}
          </span>
        )}
      </p>
      <h3 lang="en" className="text-[15px] leading-snug font-semibold text-ink">
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className="hover:underline">
            {article.headline}
          </a>
        ) : (
          article.headline
        )}
      </h3>
      {article.summary && (
        <p lang="en" className="line-clamp-3 text-[13px] leading-relaxed text-slate-strong">
          {article.summary}
        </p>
      )}
      {article.related.length > 0 && (
        <ul aria-label="หุ้นที่เกี่ยวข้อง" className="flex flex-wrap gap-1.5">
          {article.related.map((sym) => (
            <li key={sym}>
              <Link
                href={`/stocks/${encodeURIComponent(sym)}`}
                className="inline-flex min-h-7 items-center rounded-full bg-sky-soft px-2.5 font-display text-[11.5px] font-extrabold text-sky-ink"
              >
                {sym}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
        {others.length > 0 ? (
          <details className="text-[11.5px] text-slate">
            <summary className="cursor-pointer">รายงานโดยอีก {others.length} แหล่งข่าว</summary>
            <ul className="mt-1.5 space-y-1">
              {others.map((s) => {
                const link = safeExternalUrl(s.url);
                return (
                  <li key={s.id}>
                    {link ? (
                      <a
                        href={link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline-offset-2 hover:underline"
                      >
                        {publisherName(s.source)}
                      </a>
                    ) : (
                      publisherName(s.source)
                    )}{" "}
                    · {formatRelativeTime(s.publishedAt, now)}
                  </li>
                );
              })}
            </ul>
          </details>
        ) : (
          <span />
        )}
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-8 items-center gap-1 text-[12px] font-medium text-mint-deep hover:underline"
          >
            อ่านข่าวต้นฉบับ
            <ExternalLink aria-hidden className="size-3.5" />
          </a>
        )}
      </div>
    </article>
  );
}
