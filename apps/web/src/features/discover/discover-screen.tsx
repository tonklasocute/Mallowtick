"use client";

import { useState } from "react";

import { Logo } from "@/components/brand/logo";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

import { DiscoverHero } from "./discover-hero";
import { MarketOverview } from "./market-overview";
import { SearchBox } from "./search-box";
import { SearchResults } from "./search-results";
import { SectorRotation } from "./sector-rotation";

export function DiscoverScreen() {
  const [query, setQuery] = useState("");
  const trimmed = query.trim();
  const debounced = useDebouncedValue(trimmed, 300);

  return (
    <PageContainer width="wide">
      <PageHeader
        title={
          <>
            {/* The sidebar carries the logo on large screens. */}
            <span className="lg:hidden">
              <Logo />
            </span>
            <h1 className="sr-only font-display text-2xl font-bold text-ink lg:not-sr-only">
              สำรวจ
            </h1>
          </>
        }
      />
      <main className="pb-nav space-y-4 px-4 lg:space-y-6">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-center lg:gap-6">
          <DiscoverHero />
          <div className="space-y-2">
            <SearchBox value={query} onChange={setQuery} />
            <p className="hidden px-1 text-xs text-slate lg:block">
              ลองพิมพ์ชื่อย่อหุ้น เช่น AAPL หรือ BRK.B หรือชื่อบริษัท เช่น “Microsoft”
            </p>
          </div>
        </div>
        {trimmed ? (
          <div className="lg:max-w-2xl">
            <SearchResults query={debounced} pending={debounced !== trimmed} />
          </div>
        ) : (
          <>
            <MarketOverview />
            <SectorRotation />
          </>
        )}
      </main>
    </PageContainer>
  );
}
