"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";

import { BackButton } from "@/components/layout/back-button";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { ApiErrorState } from "@/components/market/api-error-state";
import { SymbolAvatar } from "@/components/stocks/symbol-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { StateMessage } from "@/components/ui/state-message";
import { NoteBox } from "@/features/stock-detail/detail-ui";
import { useMySymbols } from "@/hooks/use-my-symbols";
import { cn } from "@/lib/cn";
import { formatCompact, formatNumber, formatPrice, formatSignedPercent } from "@/lib/format";
import { vendorLabel } from "@/lib/providers";
import { dataLabel, MAX_COMPARE } from "@/lib/research";
import { normalizeSymbol } from "@/lib/symbols";
import { useCompare } from "@/services/api/queries";
import type { CompareItem } from "@/types/api";

const money = (v: number | null | undefined) => (v == null ? "—" : `$${formatCompact(v)}`);
const ratio = (v: number | null | undefined) => (v == null ? "—" : formatNumber(v, 1));
const pct = (v: number | null | undefined) => (v == null ? "—" : formatSignedPercent(v));

/** The rows of the comparison: a label and how to read each item's value. */
const ROWS: { label: string; value: (i: CompareItem) => string }[] = [
  { label: "ราคา", value: (i) => formatPrice(i.price, i.currency || "USD") },
  { label: "เปลี่ยนแปลงวันนี้", value: (i) => pct(i.changePercent) },
  { label: "มูลค่าบริษัท", value: (i) => money(i.fundamentals?.metrics.marketCap) },
  { label: "P/E (TTM)", value: (i) => ratio(i.fundamentals?.metrics.peTTM) },
  { label: "P/S (TTM)", value: (i) => ratio(i.fundamentals?.metrics.psTTM) },
  { label: "อัตรากำไรสุทธิ", value: (i) => pct(i.fundamentals?.metrics.netMarginTTM) },
  { label: "รายได้โต (YoY)", value: (i) => pct(i.fundamentals?.metrics.revenueGrowthYoY) },
  { label: "ผลตอบแทนตั้งแต่ต้นปี", value: (i) => pct(i.fundamentals?.metrics.priceReturnYTD) },
  { label: "Beta", value: (i) => ratio(i.fundamentals?.metrics.beta) },
  {
    label: "อัตราเงินปันผล",
    value: (i) => {
      const y = i.fundamentals?.metrics.dividendYield;
      return y == null ? "—" : `${formatNumber(y, 2)}%`;
    },
  },
  {
    label: "EPS ดีกว่าคาด",
    value: (i) =>
      i.epsRecord && i.epsRecord.compared > 0
        ? `${i.epsRecord.beats} จาก ${i.epsRecord.compared} ไตรมาส`
        : "—",
  },
  {
    label: "นักวิเคราะห์ ซื้อ / ถือ / ขาย",
    value: (i) =>
      i.ratings
        ? `${i.ratings.strongBuy + i.ratings.buy} / ${i.ratings.hold} / ${i.ratings.sell + i.ratings.strongSell}`
        : "—",
  },
];

export function CompareScreen({ initial = [] }: { initial?: string[] }) {
  const mine = useMySymbols();
  const [picked, setPicked] = useState<string[]>(initial.slice(0, MAX_COMPARE));
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const compare = useCompare(picked);

  const toggle = (s: string) =>
    setPicked((p) =>
      p.includes(s) ? p.filter((x) => x !== s) : p.length < MAX_COMPARE ? [...p, s] : p,
    );
  const add = () => {
    const s = normalizeSymbol(input);
    if (!s) return setError("สัญลักษณ์หุ้นไม่ถูกต้อง");
    if (picked.length >= MAX_COMPARE && !picked.includes(s))
      return setError(`เปรียบเทียบได้สูงสุด ${MAX_COMPARE} ตัว`);
    setError(null);
    setInput("");
    if (!picked.includes(s)) setPicked((p) => [...p, s]);
  };
  const suggestions = mine.all.filter((s) => !picked.includes(s)).slice(0, 12);
  const items = compare.data?.items ?? [];

  return (
    <PageContainer>
      <PageHeader leading={<BackButton fallback="/briefing" />} title="เปรียบเทียบหุ้น" />
      <main className="pb-nav space-y-3.5 px-4">
        <div className="space-y-2.5">
          <ul aria-label="หุ้นที่เลือก" className="flex flex-wrap gap-2">
            {picked.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  aria-label={`เอา ${s} ออก`}
                  onClick={() => toggle(s)}
                  className="inline-flex min-h-9 items-center gap-1 rounded-full bg-ink px-3 font-display text-[13px] font-extrabold text-surface"
                >
                  {s}
                  <X aria-hidden className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
            className="flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface py-1 pr-1 pl-4 focus-within:border-ink"
          >
            <label htmlFor="compare-symbol" className="sr-only">
              สัญลักษณ์หุ้นที่จะเพิ่ม
            </label>
            <input
              id="compare-symbol"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="เพิ่มสัญลักษณ์หุ้น เช่น MSFT"
              autoCapitalize="characters"
              className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-faint"
            />
            <button
              type="submit"
              aria-label="เพิ่มหุ้น"
              className="grid size-9 place-items-center rounded-full bg-ink text-surface"
            >
              <Plus aria-hidden className="size-4" />
            </button>
          </form>
          {error && (
            <p role="alert" className="px-1 text-xs text-down">
              {error}
            </p>
          )}
          {suggestions.length > 0 && picked.length < MAX_COMPARE && (
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggle(s)}
                  className="min-h-8 rounded-full border border-line bg-surface px-2.5 font-display text-[12px] font-bold text-slate-strong hover:border-line-strong"
                >
                  + {s}
                </button>
              ))}
            </div>
          )}
        </div>

        {picked.length < 2 ? (
          <StateMessage
            title="เลือกหุ้นอย่างน้อย 2 ตัวเพื่อเปรียบเทียบ"
            description={`สูงสุด ${MAX_COMPARE} ตัว`}
          />
        ) : compare.isPending ? (
          <Skeleton className="h-96 w-full rounded-[20px]" />
        ) : !compare.data ? (
          <ApiErrorState error={compare.error} onRetry={() => void compare.refetch()} />
        ) : (
          <>
            <div className="-mx-4 overflow-x-auto px-4">
              <table className="w-full min-w-[22rem] border-separate border-spacing-0 rounded-[20px] border border-line bg-surface text-[12.5px] shadow-soft">
                <caption className="sr-only">ตัวเลขของหุ้นที่เลือกเทียบกัน</caption>
                <thead>
                  <tr>
                    <th
                      scope="col"
                      className="sticky left-0 bg-surface p-2.5 text-left font-normal text-slate"
                    >
                      <span className="sr-only">ตัวเลข</span>
                    </th>
                    {items.map((i) => (
                      <th key={i.symbol} scope="col" className="p-2.5 text-right align-bottom">
                        <span className="flex flex-col items-end gap-1">
                          <SymbolAvatar symbol={i.symbol} logo={i.logo} />
                          <span className="font-display text-[14px] font-black text-ink">
                            {i.symbol}
                          </span>
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((row, r) => (
                    <tr key={row.label} className={cn(r % 2 === 0 && "bg-cream-deep/60")}>
                      <th
                        scope="row"
                        className="sticky left-0 bg-inherit p-2.5 text-left font-normal text-slate"
                      >
                        {row.label}
                      </th>
                      {items.map((i) => (
                        <td
                          key={i.symbol}
                          className="tabular p-2.5 text-right font-display font-extrabold text-ink"
                        >
                          {row.value(i)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {items.some((i) => i.missing.length > 0) && (
              <p
                role="status"
                className="rounded-2xl bg-honey px-3.5 py-2.5 text-xs text-honey-ink"
              >
                ข้อมูลที่ไม่มีแสดงเป็น “—”:{" "}
                {items
                  .filter((i) => i.missing.length > 0)
                  .map((i) => `${i.symbol} (${i.missing.map((m) => dataLabel(m.data)).join(", ")})`)
                  .join(" · ")}
              </p>
            )}
            <NoteBox icon>
              ข้อมูลจาก{" "}
              {[...new Set(items.flatMap((i) => i.sources))].map(vendorLabel).join(", ") || "—"}
              {" · "}ตัวเลขทางการเงินเป็นของรอบล่าสุด (TTM) ตามที่ผู้ให้บริการรายงาน ·{" "}
              {compare.data.disclaimer}
            </NoteBox>
          </>
        )}
      </main>
    </PageContainer>
  );
}
