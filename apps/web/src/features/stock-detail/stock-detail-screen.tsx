"use client";

import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { IconButton } from "@/components/ui/button";
import { useWatchlist } from "@/features/watchlist/use-watchlist";
import { WatchlistToggle } from "@/features/watchlist/watchlist-toggle";
import { labelLevels } from "@/lib/levels";
import { useCandles, useLevels, useQuote } from "@/services/api/queries";
import type { ChartRange } from "@/types/api";

import { AnalystRatings } from "./analyst-ratings";
import { ChartPanel } from "./chart-panel";
import { CompanyFundamentals } from "./company-fundamentals";
import { EarningsHistory } from "./earnings-history";
import { KeyLevels } from "./key-levels";
import { PriceHeader } from "./price-header";
import { QuoteStats } from "./quote-stats";

export function StockDetailScreen({ symbol }: { symbol: string }) {
  const router = useRouter();
  // Daily candles over one month by default.
  const [range, setRange] = useState<ChartRange>("1m");
  const quote = useQuote(symbol);
  const candles = useCandles(symbol, range);
  const levelsQuery = useLevels(symbol, range);
  const watchlist = useWatchlist();

  const levels = useMemo(
    () =>
      levelsQuery.data ? labelLevels(levelsQuery.data.levels, levelsQuery.data.referencePrice) : [],
    [levelsQuery.data],
  );

  return (
    <PageContainer>
      <PageHeader
        leading={
          <IconButton
            label="ย้อนกลับ"
            onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))}
          >
            <ChevronLeft aria-hidden className="size-6" />
          </IconButton>
        }
        title={<p className="font-display text-lg font-bold text-ink">{symbol}</p>}
        trailing={<WatchlistToggle symbol={symbol} />}
      />
      <main className="pb-nav space-y-4 px-4">
        <PriceHeader symbol={symbol} query={quote} />
        {watchlist.error && (
          <p role="alert" className="rounded-xl bg-accent-soft px-3 py-2 text-sm text-down">
            {watchlist.error.message}
          </p>
        )}
        <ChartPanel range={range} onRangeChange={setRange} candles={candles} levels={levels} />
        <KeyLevels range={range} query={levelsQuery} levels={levels} />
        {quote.data && <QuoteStats quote={quote.data} />}
        <CompanyFundamentals symbol={symbol} />
        <EarningsHistory symbol={symbol} />
        <AnalystRatings symbol={symbol} />
        <p className="px-1 text-[11px] leading-relaxed text-slate">
          ใช้เป็นข้อมูลประกอบเท่านั้น ไม่ใช่คำแนะนำการลงทุน
          ราคาและข้อมูลบริษัทมาจากผู้ให้บริการข้อมูลตลาดที่ตั้งค่าไว้ ส่วนแนวรับ-แนวต้านคำนวณโดย
          Mallowtick
        </p>
      </main>
    </PageContainer>
  );
}
