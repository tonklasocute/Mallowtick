"use client";

import { ChevronDown, PieChart, Plus, Star } from "lucide-react";
import { useId, useMemo, useState } from "react";

import { Mascot } from "@/components/brand/mascot";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { ApiErrorState } from "@/components/market/api-error-state";
import { SymbolAvatar } from "@/components/stocks/symbol-avatar";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useWatchlist } from "@/features/watchlist/use-watchlist";
import { cn } from "@/lib/cn";
import { formatMarketTime, formatSignedPercent } from "@/lib/format";
import { vendorLabel } from "@/lib/providers";
import { unavailableReasonLabel } from "@/lib/unavailable-reason";
import { useQuotes, useUsdThb } from "@/services/api/queries";
import type { Quote } from "@/types/api";

import { GoalsSheet } from "./goals-sheet";
import { HoldingSheet } from "./holding-sheet";
import {
  allocationSlices,
  type Currency,
  formatMoney,
  type HoldingValue,
  type PortfolioValuation,
  valuePortfolio,
} from "./portfolio-model";
import { AllocationDonut, SLICE_FILLS } from "./portfolio-ui";
import { usePortfolio, usePortfolioStorageDescription } from "./use-portfolio";

/*
 * After the "พอร์ตของฉัน" canvas (Main, Holding, Goals, Empty): a dark summary card with the
 * goal, a folded allocation donut, and the holdings with a "loss only" filter. Holdings are
 * stored on the device; prices and the baht rate come from the API.
 */

type OpenSheet = { kind: "holding"; symbol: string | null } | { kind: "goals" } | null;

const formatShares = (n: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(n);

function SummaryCard({ v, onGoals }: { v: PortfolioValuation; onGoals: () => void }) {
  const up = v.pl >= 0;
  return (
    <section
      aria-label="สรุปพอร์ต"
      className="flex flex-col gap-3.5 rounded-panel bg-ink p-5 text-surface"
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] text-spot-soft">มูลค่ารวม</span>
        <span className="tabular font-display text-[38px] leading-none font-black tracking-[-1px]">
          {formatMoney(v.total, v.currency)}
        </span>
        <span
          className={cn(
            "tabular font-display text-[15px] font-extrabold",
            up ? "text-spot-up" : "text-heat-1",
          )}
        >
          {formatMoney(v.pl, v.currency, true)}
          {v.plPct !== null && ` (${formatSignedPercent(v.plPct)})`}
          {v.dayPct !== null && (
            <span className="font-sans text-xs font-normal text-spot-soft">
              {" "}
              · วันนี้ {formatSignedPercent(v.dayPct)}
            </span>
          )}
        </span>
        {v.stockPart !== null && v.fxPart !== null && v.fxPart !== 0 && (
          <span className="text-xs text-spot-soft">
            จากราคาหุ้น {formatMoney(v.stockPart, "THB", true)} · จากค่าเงินบาท{" "}
            {formatMoney(v.fxPart, "THB", true)}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={onGoals}
        className="flex flex-col gap-1.5 rounded-2xl bg-surface/8 p-3 text-left"
      >
        {v.goal ? (
          <>
            <span className="flex justify-between text-xs text-spot-soft">
              <span>เป้าหมาย {formatMoney(v.goal.amount, v.currency)}</span>
              <span className="font-display text-[13px] font-black text-surface">
                {v.goal.progress.toFixed(0)}%
              </span>
            </span>
            <span aria-hidden className="relative h-2 overflow-hidden rounded-full bg-surface/15">
              <span
                className="absolute inset-y-0 left-0 rounded-full bg-spot-up"
                style={{ width: `${v.goal.progress}%` }}
              />
            </span>
          </>
        ) : (
          <span className="text-[13px] text-spot-soft">ตั้งเป้าหมายพอร์ต</span>
        )}
      </button>
    </section>
  );
}

function Allocation({ v }: { v: PortfolioValuation }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const slices = allocationSlices(v);
  if (slices.length === 0) return null;
  const top = slices[0]!;
  return (
    <section className="overflow-hidden rounded-3xl border border-line bg-surface">
      <h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((o) => !o)}
          className="flex min-h-[60px] w-full items-center gap-2.5 px-4 py-3 text-left"
        >
          <span
            aria-hidden
            className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-sky-soft text-sky-ink"
          >
            <PieChart className="size-4" strokeWidth={2.2} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-[15px] font-medium text-ink">สัดส่วนพอร์ต</span>
            <span className="text-xs text-slate">
              {open ? "แตะเพื่อซ่อน" : `ใหญ่สุด ${top.label} ${top.pct.toFixed(1)}% · แตะเพื่อดู`}
            </span>
          </span>
          <ChevronDown
            aria-hidden
            className={cn("size-[18px] text-slate transition-transform", open && "rotate-180")}
            strokeWidth={2.4}
          />
        </button>
      </h2>
      {open && (
        <div id={bodyId} className="flex items-center gap-4 px-4 pt-1 pb-4">
          <AllocationDonut slices={slices} count={v.rows.length - v.unpriced.length} />
          <ul className="flex min-w-0 flex-1 flex-col gap-[7px]">
            {slices.map((s, i) => (
              <li
                key={s.label}
                className="flex items-center gap-2 font-display text-[13px] font-bold text-ink"
              >
                <span
                  aria-hidden
                  className={cn(
                    "size-2.5 shrink-0 rounded-[3px]",
                    SLICE_FILLS[i % SLICE_FILLS.length],
                  )}
                />
                <span className="flex-1 truncate">{s.label}</span>
                <span className="tabular font-black">{s.pct.toFixed(1)}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function HoldingRow({
  row,
  currency,
  reason,
  onOpen,
}: {
  row: HoldingValue;
  currency: Currency;
  reason: string | null;
  onOpen: () => void;
}) {
  const { holding: h, quote } = row;
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-3 rounded-[20px] border border-line bg-surface px-3.5 py-3 text-left transition hover:bg-cream"
      >
        <SymbolAvatar symbol={h.symbol} logo={quote?.logo} shape="square" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="font-display text-[15px] font-black text-ink">{h.symbol}</span>
          <span className="text-xs text-slate">{formatShares(h.shares)} หุ้น</span>
        </span>
        {row.value !== null && row.plPct !== null ? (
          <span className="flex flex-col items-end gap-0.5">
            <span className="tabular font-display text-[15px] font-black text-ink">
              {formatMoney(row.value, currency)}
            </span>
            <span
              className={cn(
                "tabular font-display text-[12.5px] font-extrabold",
                row.plPct >= 0 ? "text-up" : "text-down",
              )}
            >
              {formatSignedPercent(row.plPct)}
            </span>
          </span>
        ) : (
          <span className="text-right text-xs text-slate">{reason ?? "ยังไม่มีราคา"}</span>
        )}
      </button>
    </li>
  );
}

function EmptyPortfolio({ onAdd }: { onAdd: () => void }) {
  const wl = useWatchlist();
  return (
    <div className="flex flex-col gap-4">
      <section className="relative flex flex-col items-center gap-3 overflow-hidden rounded-[28px] bg-mint-soft px-5 pt-7 pb-6 text-center">
        <span
          aria-hidden
          className="absolute -top-12 -right-10 size-[130px] rounded-full bg-sky-soft"
        />
        <span
          aria-hidden
          className="absolute -bottom-8 -left-5 size-[70px] rounded-full bg-accent-soft"
        />
        <Mascot size={96} className="relative" />
        <h2 className="relative text-[19px] font-medium text-ink">ยังไม่มีหุ้นในพอร์ต</h2>
        <p className="relative max-w-[280px] text-[13px] leading-relaxed font-light text-slate-strong">
          ใส่หุ้นที่ถืออยู่ จำนวนหุ้น และราคาเฉลี่ย แล้ว Mallowtick จะคิดมูลค่า กำไร/ขาดทุน
          เป็นบาทและดอลลาร์ให้ทุกนาที
        </p>
        <button
          type="button"
          onClick={onAdd}
          className="relative mt-1 inline-flex h-[52px] items-center gap-2 rounded-full bg-ink px-6 text-[15px] font-medium text-surface shadow-pressed"
        >
          <Plus aria-hidden className="size-[18px]" strokeWidth={2.4} />
          เพิ่มหุ้นตัวแรก
        </button>
      </section>
      {wl.symbols.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="mx-1 text-[15px] font-medium text-ink">หรือเริ่มเร็วกว่านั้น</h2>
          <button
            type="button"
            onClick={onAdd}
            className="flex items-center gap-3 rounded-[20px] border border-line bg-surface p-3.5 text-left"
          >
            <span
              aria-hidden
              className="grid size-10 place-items-center rounded-xl bg-honey text-honey-ink"
            >
              <Star className="size-[18px]" strokeWidth={2} />
            </span>
            <span className="flex flex-1 flex-col">
              <span className="text-sm text-ink">เลือกจากหุ้นที่สนใจ</span>
              <span className="text-xs font-light text-slate">
                มีอยู่ {wl.symbols.length} ตัว แล้วค่อยใส่จำนวนหุ้นทีละตัว
              </span>
            </span>
          </button>
        </section>
      )}
    </div>
  );
}

function PortfolioSkeleton() {
  return (
    <div aria-busy="true" aria-label="กำลังโหลดพอร์ต" className="space-y-3">
      <Skeleton className="h-52 w-full rounded-panel" />
      <Skeleton className="h-16 w-full rounded-3xl" />
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-[68px] w-full rounded-[20px]" />
      ))}
    </div>
  );
}

export function PortfolioScreen() {
  const { portfolio, isLoading, error, update } = usePortfolio();
  const storage = usePortfolioStorageDescription();
  const [sheet, setSheet] = useState<OpenSheet>(null);
  const [lossOnly, setLossOnly] = useState(false);
  const symbols = useMemo(() => portfolio.holdings.map((h) => h.symbol), [portfolio.holdings]);
  const quotes = useQuotes(symbols);
  const fx = useUsdThb(symbols.length > 0);

  const bySymbol = useMemo(
    () => new Map<string, Quote>(quotes.data?.quotes.map((q) => [q.symbol, q])),
    [quotes.data],
  );
  const reasons = new Map(
    quotes.data?.unavailable.map((u) => [u.symbol, unavailableReasonLabel(u.reason)]),
  );
  const rate = fx.data?.rate ?? null;
  const v = valuePortfolio(portfolio, bySymbol, rate);
  const losers = v.rows.filter((r) => r.pl !== null && r.pl < 0);
  const rows = lossOnly ? losers : v.rows;
  const hasHoldings = portfolio.holdings.length > 0;
  const waitingForRate = portfolio.currency === "THB" && fx.isPending;
  const noRate = portfolio.currency === "THB" && !fx.isPending && rate === null;
  const vendor = quotes.data?.quotes[0]?.freshness.provider;

  return (
    <PageContainer>
      <PageHeader
        title="พอร์ตของฉัน"
        trailing={
          hasHoldings && (
            <>
              <button
                type="button"
                aria-label={`สลับสกุลเงิน ตอนนี้แสดงเป็น${portfolio.currency === "THB" ? "บาท" : "ดอลลาร์"}`}
                onClick={() =>
                  update((p) => ({ ...p, currency: p.currency === "THB" ? "USD" : "THB" }))
                }
                className="h-11 rounded-full border border-line bg-surface px-3.5 font-display text-sm font-extrabold text-ink"
              >
                {portfolio.currency === "THB" ? "฿ บาท" : "$ USD"}
              </button>
              <button
                type="button"
                aria-label="เพิ่มหุ้นในพอร์ต"
                onClick={() => setSheet({ kind: "holding", symbol: null })}
                className="grid size-11 place-items-center rounded-full bg-ink text-surface"
              >
                <Plus aria-hidden className="size-5" strokeWidth={2.4} />
              </button>
            </>
          )
        }
      />
      <main className="pb-nav flex flex-col gap-4 px-4">
        {error && (
          <p role="alert" className="rounded-xl bg-accent-soft px-3 py-2 text-sm text-down">
            {error.message}
          </p>
        )}
        {isLoading ? (
          <PortfolioSkeleton />
        ) : !hasHoldings ? (
          <EmptyPortfolio onAdd={() => setSheet({ kind: "holding", symbol: null })} />
        ) : (quotes.isPending && !quotes.data) || waitingForRate ? (
          <PortfolioSkeleton />
        ) : (
          <>
            {quotes.error && !quotes.data && (
              <Card>
                <ApiErrorState error={quotes.error} onRetry={() => void quotes.refetch()} compact />
              </Card>
            )}
            {noRate && (
              <p
                role="status"
                className="rounded-2xl bg-honey px-3.5 py-2.5 text-xs text-honey-ink"
              >
                ยังไม่มีเรทเงินบาทในตอนนี้ จึงแสดงเป็นดอลลาร์ไปก่อน
              </p>
            )}
            <SummaryCard v={v} onGoals={() => setSheet({ kind: "goals" })} />
            {v.unpriced.length > 0 && (
              <p role="status" className="px-1 text-xs text-slate">
                ยังไม่รวม {v.unpriced.join(", ")} เพราะยังไม่มีราคา
              </p>
            )}
            <Allocation v={v} />
            <section aria-labelledby="holdings-title" className="flex flex-col gap-2.5">
              <div className="mx-1 flex items-center justify-between">
                <h2 id="holdings-title" className="text-[17px] font-medium text-ink">
                  หุ้นในพอร์ต
                </h2>
                <div
                  role="group"
                  aria-label="กรองหุ้น"
                  className="flex gap-0.5 rounded-full bg-cream-deep p-1"
                >
                  {[
                    { on: !lossOnly, label: "ทั้งหมด", pick: () => setLossOnly(false) },
                    {
                      on: lossOnly,
                      label: `ติดลบ ${losers.length}`,
                      pick: () => setLossOnly(true),
                    },
                  ].map((f) => (
                    <button
                      key={f.label}
                      type="button"
                      aria-pressed={f.on}
                      onClick={f.pick}
                      className={cn(
                        "h-9 rounded-full px-3 text-[12.5px]",
                        f.on ? "bg-ink text-surface" : "text-slate",
                      )}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
              <ul className="flex flex-col gap-2">
                {rows.map((r) => (
                  <HoldingRow
                    key={r.holding.symbol}
                    row={r}
                    currency={v.currency}
                    reason={reasons.get(r.holding.symbol) ?? null}
                    onOpen={() => setSheet({ kind: "holding", symbol: r.holding.symbol })}
                  />
                ))}
              </ul>
              {lossOnly && losers.length === 0 && (
                <p className="rounded-2xl bg-mint-soft p-3.5 text-center text-[13px] text-up">
                  ไม่มีหุ้นที่ติดลบ
                </p>
              )}
            </section>
            <p className="px-1 text-[11px] leading-relaxed font-light text-slate">
              {fx.data &&
                `1 USD = ${fx.data.rate.toFixed(2)} บาท (${vendorLabel(fx.data.freshness.provider)} · ${formatMarketTime(fx.data.asOf ?? fx.data.freshness.fetchedAt)})`}
              {vendor && ` · ราคาจาก ${vendorLabel(vendor)}`}
              {storage && ` · ${storage}`}
            </p>
          </>
        )}
        {!hasHoldings && !isLoading && storage && (
          <p className="px-1 text-[11px] font-light text-slate">{storage} ไม่ส่งขึ้นเซิร์ฟเวอร์</p>
        )}
      </main>
      {sheet?.kind === "holding" && (
        <HoldingSheet symbol={sheet.symbol} onClose={() => setSheet(null)} />
      )}
      {sheet?.kind === "goals" && (
        <GoalsSheet valuation={v} rate={rate} onClose={() => setSheet(null)} />
      )}
    </PageContainer>
  );
}
