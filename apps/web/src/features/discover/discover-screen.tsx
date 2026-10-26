"use client";

import { useState } from "react";

import { Logo } from "@/components/brand/logo";
import { PageHeader } from "@/components/layout/page-header";
import { MarketStatusPill } from "@/components/market/market-status-pill";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { BRAND } from "@/lib/brand";

import { MarketOverview } from "./market-overview";
import { SearchBox } from "./search-box";
import { SearchResults } from "./search-results";

export function DiscoverScreen() {
  const [query, setQuery] = useState("");
  const trimmed = query.trim();
  const debounced = useDebouncedValue(trimmed, 300);

  return (
    <>
      <PageHeader title={<Logo />} />
      <main className="pb-nav space-y-4 px-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-display text-sm text-slate-strong">{BRAND.tagline}</p>
          <MarketStatusPill />
        </div>
        <SearchBox value={query} onChange={setQuery} />
        {trimmed ? (
          <SearchResults query={debounced} pending={debounced !== trimmed} />
        ) : (
          <MarketOverview />
        )}
      </main>
    </>
  );
}
