import type { Metadata } from "next";

import { NewsScreen, type NewsTab } from "@/features/news/news-screen";
import { normalizeSymbol } from "@/lib/symbols";

export const metadata: Metadata = { title: "ข่าว" };

const TABS: NewsTab[] = ["for-you", "market", "company"];

export default async function NewsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[]; symbol?: string | string[] }>;
}) {
  const { tab, symbol } = await searchParams;
  const initialTab = TABS.find((t) => t === tab) ?? "for-you";
  const initialSymbol = typeof symbol === "string" ? normalizeSymbol(symbol) : null;
  return <NewsScreen initialTab={initialTab} initialSymbol={initialSymbol} />;
}
