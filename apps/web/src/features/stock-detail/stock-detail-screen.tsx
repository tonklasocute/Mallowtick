"use client";

import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Mascot } from "@/components/brand/mascot";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { IconButton } from "@/components/ui/button";
import { useWatchlist } from "@/features/watchlist/use-watchlist";
import { WatchlistToggle } from "@/features/watchlist/watchlist-toggle";
import { formatPrice } from "@/lib/format";
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

/** Circle buttons of the page header, as on the design canvas. */
const HEADER_BUTTON = "size-11 border border-line bg-surface";

/**
 * True once the element has scrolled up under the sticky header (about 64px), so the
 * header can repeat the price. Without IntersectionObserver it stays false.
 */
function useScrolledPast() {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [past, setPast] = useState(false);
  useEffect(() => {
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setPast(!!entry && !entry.isIntersecting && entry.boundingClientRect.top < 64),
      { rootMargin: "-64px 0px 0px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return [setEl, past] as const;
}

export function StockDetailScreen({ symbol }: { symbol: string }) {
  const router = useRouter();
  // Daily candles over one month by default.
  const [range, setRange] = useState<ChartRange>("1m");
  const quote = useQuote(symbol);
  const candles = useCandles(symbol, range);
  const levelsQuery = useLevels(symbol, range);
  const watchlist = useWatchlist();
  const [priceRef, priceScrolledPast] = useScrolledPast();

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
            className={HEADER_BUTTON}
            onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))}
          >
            <ChevronLeft aria-hidden className="size-5" strokeWidth={2.4} />
          </IconButton>
        }
        title={
          <p className="ml-1 font-display text-xl font-black text-ink">
            {symbol}
            {priceScrolledPast && quote.data && (
              <small className="tabular ml-1.5 text-[13px] font-extrabold text-slate">
                {formatPrice(quote.data.price, quote.data.currency)}
              </small>
            )}
          </p>
        }
        trailing={<WatchlistToggle symbol={symbol} className={HEADER_BUTTON} />}
      />
      <main className="pb-nav space-y-4 px-4">
        <PriceHeader symbol={symbol} query={quote} priceRef={priceRef} />
        {watchlist.error && (
          <p role="alert" className="rounded-xl bg-accent-soft px-3 py-2 text-sm text-down">
            {watchlist.error.message}
          </p>
        )}
        <ChartPanel range={range} onRangeChange={setRange} candles={candles} levels={levels} />
        <KeyLevels range={range} query={levelsQuery} levels={levels} />
        {quote.data && <QuoteStats symbol={symbol} quote={quote.data} />}
        <CompanyFundamentals symbol={symbol} />
        <EarningsHistory symbol={symbol} />
        <AnalystRatings symbol={symbol} />
        <div className="flex items-center gap-3 rounded-[20px] border-[1.5px] border-dashed border-line-strong p-3.5 text-[11.5px] leading-[1.7] font-light text-slate">
          <Mascot size={44} />
          <p>
            ใช้เป็นข้อมูลประกอบเท่านั้น ไม่ใช่คำแนะนำการลงทุน
            ราคาและข้อมูลบริษัทมาจากผู้ให้บริการข้อมูลตลาดที่ตั้งค่าไว้ ส่วนแนวรับ-แนวต้านคำนวณโดย
            Mallowtick
          </p>
        </div>
      </main>
    </PageContainer>
  );
}
