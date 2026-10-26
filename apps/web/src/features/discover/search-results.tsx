"use client";

import Link from "next/link";

import { ApiErrorState } from "@/components/market/api-error-state";
import { SymbolAvatar } from "@/components/stocks/symbol-avatar";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StateMessage } from "@/components/ui/state-message";
import { WatchlistToggle } from "@/features/watchlist/watchlist-toggle";
import { useSearch } from "@/services/api/queries";

function ResultsSkeleton() {
  return (
    <Card aria-busy="true" aria-label="กำลังค้นหา">
      <ul className="space-y-3">
        {[0, 1, 2].map((i) => (
          <li key={i} className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-full" />
            <span className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-3 w-40" />
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Results for an already-debounced query; `pending` is true while the user is still typing. */
export function SearchResults({ query, pending }: { query: string; pending: boolean }) {
  const { data, error, isPending, refetch } = useSearch(query);

  if (pending || !query || (isPending && !error)) return <ResultsSkeleton />;
  if (error) {
    return (
      <Card>
        <ApiErrorState error={error} onRetry={() => void refetch()} compact />
      </Card>
    );
  }
  const results = data?.results ?? [];
  if (results.length === 0) {
    return (
      <Card>
        <StateMessage
          compact
          title={`ไม่พบหุ้นสหรัฐฯ ที่ตรงกับ “${query}”`}
          description="ลองพิมพ์ชื่อย่อหุ้น เช่น AAPL หรือชื่อบริษัท"
        />
      </Card>
    );
  }
  return (
    <Card className="px-3 py-2">
      <p className="sr-only" role="status">
        พบ {results.length} รายการ
      </p>
      <ul className="divide-y divide-line">
        {results.map((r) => (
          <li key={`${r.symbol}-${r.exchange}`} className="flex items-center gap-1">
            <Link
              href={`/stocks/${encodeURIComponent(r.symbol)}`}
              className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-1 py-2.5 hover:bg-cream"
            >
              <SymbolAvatar symbol={r.symbol} />
              <span className="min-w-0">
                <span className="block font-display font-semibold text-ink">{r.symbol}</span>
                <span className="block truncate text-xs text-slate">
                  {r.name} · {r.exchange}
                  {r.type ? ` · ${r.type}` : ""}
                </span>
              </span>
            </Link>
            <WatchlistToggle symbol={r.symbol} />
          </li>
        ))}
      </ul>
    </Card>
  );
}
