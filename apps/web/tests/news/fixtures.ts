import type { NewsArticle, NewsPage } from "@/types/api";

import { freshness } from "../fixtures";

export function newsArticle(overrides: Partial<NewsArticle> = {}): NewsArticle {
  const base: NewsArticle = {
    id: "fh-1",
    headline: "Apple supplier raises outlook on iPhone demand",
    summary: "The supplier said demand rose.",
    url: "https://finnhub.io/api/news?id=a1",
    source: "Yahoo",
    publishedAt: "2026-10-23T17:00:00Z",
    category: "company",
    related: ["AAPL"],
    sources: [],
    provider: "finnhub",
    ...overrides,
  };
  if (base.sources.length === 0) {
    base.sources = [
      { id: base.id, source: base.source, url: base.url, publishedAt: base.publishedAt },
    ];
  }
  return base;
}

export function newsPage(articles: NewsArticle[], overrides: Partial<NewsPage> = {}): NewsPage {
  return {
    articles,
    page: 1,
    limit: 20,
    total: articles.length,
    hasMore: false,
    unavailable: [],
    freshness: freshness({ provider: "finnhub" }),
    ...overrides,
  };
}
