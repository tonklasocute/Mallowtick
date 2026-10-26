"use client";

import { ApiErrorState } from "@/components/market/api-error-state";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StateMessage } from "@/components/ui/state-message";
import { cn } from "@/lib/cn";
import { useMarketOverview } from "@/services/api/queries";

import { BenchmarkHeroCard, BenchmarkTile, UnavailableBenchmarkTile } from "./benchmark-cards";
import { buildOverviewModel } from "./overview-model";
import { PopularStocks } from "./popular-stocks";

function SectionTitle({ id, children }: { id: string; children: string }) {
  return (
    <h2 id={id} className="px-1 font-display text-base font-semibold text-ink">
      {children}
    </h2>
  );
}

function OverviewSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="กำลังโหลดภาพรวมตลาด"
      className="grid grid-cols-1 gap-5 lg:grid-cols-5"
    >
      <div className="space-y-3 lg:col-span-3">
        <Skeleton className="h-40 w-full rounded-card" />
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-28 rounded-card" />
          <Skeleton className="h-28 rounded-card" />
        </div>
      </div>
      <Skeleton className="h-72 rounded-card lg:col-span-2" />
    </div>
  );
}

/** Benchmarks and popular stocks configured on the API server, from one batch request. */
export function MarketOverview() {
  const { data, error, isPending, refetch, dataUpdatedAt } = useMarketOverview();

  if (isPending) return <OverviewSkeleton />;
  if (!data) {
    return (
      <Card>
        <ApiErrorState error={error} onRetry={() => void refetch()} />
      </Card>
    );
  }

  const m = buildOverviewModel(data);
  if (m.isEmpty) {
    return (
      <Card>
        <StateMessage
          title="เริ่มต้นด้วยการค้นหาหุ้น"
          description="เซิร์ฟเวอร์ API ยังไม่ได้ตั้งค่าดัชนีอ้างอิงหรือหุ้นยอดนิยม (MARKET_OVERVIEW_SYMBOLS, POPULAR_SYMBOLS)"
        />
      </Card>
    );
  }

  const tileCount = m.tiles.length + m.unavailableBenchmarks.length;
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
      {m.showBenchmarks && (
        <section
          aria-labelledby="benchmarks-title"
          className={cn("space-y-3", m.showPopular ? "lg:col-span-3" : "lg:col-span-5")}
        >
          <SectionTitle id="benchmarks-title">ดัชนีอ้างอิงตลาด</SectionTitle>
          {m.hero && <BenchmarkHeroCard quote={m.hero} receivedAt={dataUpdatedAt} />}
          {tileCount > 0 && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-2">
              {m.tiles.map((q) => (
                <BenchmarkTile key={q.symbol} quote={q} receivedAt={dataUpdatedAt} />
              ))}
              {m.unavailableBenchmarks.map((u) => (
                <UnavailableBenchmarkTile key={u.symbol} item={u} />
              ))}
            </div>
          )}
        </section>
      )}

      {m.showPopular && (
        <div className={m.showBenchmarks ? "lg:col-span-2" : "lg:col-span-5"}>
          <PopularStocks
            quotes={m.popular}
            unavailable={m.unavailablePopular}
            receivedAt={dataUpdatedAt}
          />
        </div>
      )}

      {m.unavailableOther.length > 0 && (
        <p role="status" className="text-xs text-slate lg:col-span-5">
          ยังไม่มีข้อมูลในขณะนี้:{" "}
          {m.unavailableOther.map((u) => `${u.symbol} (${u.label})`).join(", ")}
        </p>
      )}

      {error && (
        <p role="status" className="text-xs text-slate lg:col-span-5">
          รีเฟรชข้อมูลไม่สำเร็จ กำลังแสดงข้อมูลชุดล่าสุดที่โหลดไว้พร้อมเวลาของข้อมูล
        </p>
      )}
    </div>
  );
}
