import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { StockDetailScreen } from "@/features/stock-detail/stock-detail-screen";
import { normalizeSymbol } from "@/lib/symbols";

interface Props {
  params: Promise<{ symbol: string }>;
}

function parse(raw: string): string | null {
  try {
    return normalizeSymbol(decodeURIComponent(raw));
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const symbol = parse((await params).symbol);
  return { title: symbol ?? "ไม่พบหุ้น" };
}

export default async function StockPage({ params }: Props) {
  const symbol = parse((await params).symbol);
  if (!symbol) notFound();
  // Keyed so switching symbols resets the selected range and chart.
  return <StockDetailScreen key={symbol} symbol={symbol} />;
}
