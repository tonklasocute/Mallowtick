"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";

import { SymbolAvatar } from "@/components/stocks/symbol-avatar";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useWatchlist } from "@/features/watchlist/use-watchlist";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { cn } from "@/lib/cn";
import { formatPrice, formatSignedPercent } from "@/lib/format";
import { useQuote, useSearch, useUsdThb } from "@/services/api/queries";

import {
  formatMoney,
  type Holding,
  MAX_HOLDINGS,
  parseDecimal,
  removeHolding,
  upsertHolding,
} from "./portfolio-model";
import { usePortfolio } from "./use-portfolio";

const isNum = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);

const asText = (v: number | null) => (v === null ? "" : String(v));

/** Picks the stock to add: the watchlist's first, then any search result. */
function SymbolPicker({ held, onPick }: { held: string[]; onPick: (symbol: string) => void }) {
  const wl = useWatchlist();
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query.trim(), 300);
  const search = useSearch(debounced);
  const fromWatchlist = wl.symbols.filter((s) => !held.includes(s));
  const inputId = useId();

  return (
    <div className="flex flex-col gap-4">
      <label
        htmlFor={inputId}
        className="flex h-[52px] items-center gap-2.5 rounded-full border-[1.5px] border-line bg-surface px-4"
      >
        <Search aria-hidden className="size-5 text-slate" />
        <span className="sr-only">ค้นหาหุ้น</span>
        <input
          id={inputId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ค้นหาชื่อย่อหุ้นหรือชื่อบริษัท"
          className="h-full min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-slate"
        />
      </label>

      {!debounced && fromWatchlist.length > 0 && (
        <section aria-labelledby={`${inputId}-wl`} className="flex flex-col gap-2">
          <h3 id={`${inputId}-wl`} className="text-sm font-medium text-ink">
            จากหุ้นที่สนใจ
          </h3>
          <div className="flex flex-wrap gap-2">
            {fromWatchlist.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onPick(s)}
                className="h-11 rounded-full border border-line bg-surface px-4 font-display text-sm font-extrabold text-ink hover:bg-cream-deep"
              >
                {s}
              </button>
            ))}
          </div>
        </section>
      )}

      {debounced && (
        <ul aria-busy={search.isPending} className="flex flex-col gap-1">
          {search.isPending &&
            [0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full rounded-2xl" />)}
          {search.data?.results.map((r) => (
            <li key={`${r.symbol}-${r.exchange}`}>
              <button
                type="button"
                onClick={() => onPick(r.symbol)}
                className="flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-left hover:bg-cream-deep"
              >
                <SymbolAvatar symbol={r.symbol} logo={r.logo} shape="square" />
                <span className="min-w-0 flex-1">
                  <span className="block font-display font-extrabold text-ink">{r.symbol}</span>
                  <span className="block truncate text-xs text-slate">{r.name}</span>
                </span>
                {held.includes(r.symbol) && (
                  <span className="shrink-0 text-xs text-slate">อยู่ในพอร์ตแล้ว</span>
                )}
              </button>
            </li>
          ))}
          {search.data && search.data.results.length === 0 && (
            <li className="px-2 py-3 text-sm text-slate">ไม่พบหุ้นที่ตรงกับ “{debounced}”</li>
          )}
          {search.error && (
            <li role="alert" className="px-2 py-3 text-sm text-down">
              ค้นหาไม่สำเร็จ ลองใหม่อีกครั้ง
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  error,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
  hint?: string | null;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-[12.5px] text-slate">
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!error}
        aria-describedby={error || hint ? `${id}-note` : undefined}
        className={cn(
          "tabular h-12 w-full rounded-[14px] border-[1.5px] px-3.5 font-display text-base font-extrabold text-ink outline-none focus:border-mint-deep",
          error ? "border-down" : "border-line",
          "bg-surface",
        )}
      />
      {(error || hint) && (
        <span
          id={`${id}-note`}
          className={cn("text-[11.5px]", error ? "text-down" : "font-light text-slate")}
        >
          {error ?? hint}
        </span>
      )}
    </div>
  );
}

interface Draft {
  shares: string;
  avgCost: string;
  totalCost: string;
  /** The cost field typed last; the other one follows it. */
  from: "avg" | "total";
}

/** Positive number or null when empty; an error message otherwise. */
function readPositive(text: string): { value: number | null; error: string | null } {
  const n = parseDecimal(text);
  if (n === null) return { value: null, error: "ต้องใส่" };
  if (Number.isNaN(n) || n <= 0) return { value: null, error: "ใส่ตัวเลขที่มากกว่า 0" };
  return { value: n, error: null };
}

/** A computed amount as the field shows it: up to 4 decimals for prices, 2 for totals. */
const fieldText = (v: number, digits: number) => String(Number(v.toFixed(digits)));

/** The other cost field from the one typed, or unchanged when the shares are not usable. */
function follow(d: Draft): Draft {
  const shares = parseDecimal(d.shares);
  if (shares === null || Number.isNaN(shares) || shares <= 0) return d;
  if (d.from === "avg") {
    const avg = parseDecimal(d.avgCost);
    return avg === null || Number.isNaN(avg)
      ? { ...d, totalCost: "" }
      : { ...d, totalCost: fieldText(avg * shares, 2) };
  }
  const total = parseDecimal(d.totalCost);
  return total === null || Number.isNaN(total)
    ? { ...d, avgCost: "" }
    : { ...d, avgCost: fieldText(total / shares, 4) };
}

function HoldingForm({
  symbol,
  existing,
  onClose,
  onChangeSymbol,
}: {
  symbol: string;
  existing: Holding | null;
  onClose: () => void;
  onChangeSymbol: (() => void) | null;
}) {
  const { portfolio, update } = usePortfolio();
  const quote = useQuote(symbol);
  const fx = useUsdThb();
  const [draft, setDraft] = useState<Draft>(() => ({
    shares: asText(existing?.shares ?? null),
    avgCost: asText(existing?.avgCost ?? null),
    totalCost: existing ? fieldText(existing.shares * existing.avgCost, 2) : "",
    from: "avg",
  }));
  const [submitted, setSubmitted] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const edit = (patch: Partial<Draft>) => setDraft((d) => follow({ ...d, ...patch }));

  const shares = readPositive(draft.shares);
  const avgCost = readPositive(draft.avgCost);
  const totalCost = readPositive(draft.totalCost);
  // The typed field is the source of truth; the other is rounded for display.
  const cost = draft.from === "total" ? totalCost : avgCost;
  const avg =
    draft.from === "total" && totalCost.value !== null && shares.value !== null
      ? totalCost.value / shares.value
      : avgCost.value;
  const full = !existing && portfolio.holdings.length >= MAX_HOLDINGS;
  const valid = !full && !shares.error && !cost.error && avg !== null;
  const show = (e: string | null) => (submitted ? e : null);

  const price = quote.data?.price ?? null;
  const rate = fx.data?.rate ?? null;

  const save = () => {
    setSubmitted(true);
    if (!valid || shares.value === null || avg === null) return;
    // Fields this sheet no longer shows keep what was saved before.
    const holding: Holding = {
      buyRate: null,
      targetPrice: null,
      stopLoss: null,
      targetWeight: null,
      ...existing,
      symbol,
      shares: shares.value,
      avgCost: avg,
    };
    update((p) => upsertHolding(p, holding));
    onClose();
  };

  const usdValue = shares.value !== null && isNum(price) ? shares.value * price : null;
  const usdCost = shares.value !== null && avg !== null ? shares.value * avg : null;
  const bought = existing?.buyRate ?? rate;
  const thb =
    usdValue !== null && usdCost !== null && isNum(rate) && isNum(bought)
      ? { value: usdValue * rate, cost: usdCost * bought }
      : null;
  const pl = thb
    ? thb.value - thb.cost
    : usdValue !== null && usdCost !== null
      ? usdValue - usdCost
      : null;
  const plBase = thb ? thb.cost : usdCost;

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="flex flex-col gap-4"
    >
      <div className="flex items-center gap-3 rounded-[20px] border border-line bg-surface px-3.5 py-3">
        <SymbolAvatar symbol={symbol} logo={quote.data?.logo} shape="square" />
        <span className="min-w-0 flex-1">
          <span className="block font-display text-base font-black text-ink">{symbol}</span>
          <span className="block truncate text-xs text-slate">
            {quote.data
              ? `${quote.data.name || symbol} · ราคาตอนนี้ ${formatPrice(price)}`
              : quote.isPending
                ? "กำลังโหลดราคา…"
                : "ยังไม่มีราคา"}
          </span>
        </span>
        {onChangeSymbol ? (
          <button
            type="button"
            onClick={onChangeSymbol}
            className="h-9 shrink-0 rounded-full border border-line bg-cream-deep px-3 text-xs text-ink"
          >
            เปลี่ยนหุ้น
          </button>
        ) : (
          <Link
            href={`/stocks/${encodeURIComponent(symbol)}`}
            className="flex h-9 shrink-0 items-center rounded-full border border-line bg-cream-deep px-3 text-xs text-ink"
          >
            ดูหน้าหุ้น
          </Link>
        )}
      </div>

      <fieldset className="flex flex-col gap-2.5">
        <legend className="mb-2 text-sm font-medium text-ink">ที่ถืออยู่</legend>
        <Field
          label="จำนวนหุ้น"
          value={draft.shares}
          onChange={(v) => edit({ shares: v })}
          error={show(shares.error)}
          hint="ใส่เศษหุ้นได้ เช่น 0.25"
        />
        <div className="grid grid-cols-2 gap-2.5">
          <Field
            label="ราคาเฉลี่ยต่อหุ้น (USD)"
            value={draft.avgCost}
            onChange={(v) => edit({ avgCost: v, from: "avg" })}
            error={draft.from === "avg" ? show(avgCost.error) : null}
          />
          <Field
            label="ต้นทุนรวม (USD)"
            value={draft.totalCost}
            onChange={(v) => edit({ totalCost: v, from: "total" })}
            error={draft.from === "total" ? show(totalCost.error) : null}
          />
        </div>
        <span className="text-[11.5px] font-light text-slate">
          ใส่ราคาเฉลี่ยหรือต้นทุนรวมช่องใดก็ได้ อีกช่องจะคำนวณให้เอง
        </span>
      </fieldset>

      {isNum(usdValue) && isNum(usdCost) && isNum(pl) && isNum(plBase) && (
        <section
          aria-label="ผลลัพธ์"
          className="flex flex-col gap-2.5 rounded-[20px] border border-line bg-surface p-3.5"
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[12.5px] text-slate">มูลค่าตอนนี้</span>
            <span className="tabular font-display text-lg font-black text-ink">
              {thb && formatMoney(thb.value, "THB")}{" "}
              <span className="text-xs font-bold text-slate">{formatMoney(usdValue, "USD")}</span>
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[12.5px] text-slate">ต้นทุน</span>
            <span className="tabular font-display text-sm font-extrabold text-ink">
              {thb && formatMoney(thb.cost, "THB")}{" "}
              <span className="text-xs font-bold text-slate">{formatMoney(usdCost, "USD")}</span>
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[12.5px] text-slate">กำไร/ขาดทุน</span>
            <span
              className={cn(
                "tabular font-display text-[15px] font-black",
                pl >= 0 ? "text-up" : "text-down",
              )}
            >
              {formatMoney(pl, thb ? "THB" : "USD", true)} (
              {formatSignedPercent((pl / plBase) * 100)})
            </span>
          </div>
        </section>
      )}

      {full && (
        <p role="alert" className="text-sm text-down">
          เก็บหุ้นในพอร์ตได้สูงสุด {MAX_HOLDINGS} ตัว
        </p>
      )}

      <div className="flex gap-2.5">
        {existing && (
          <button
            type="button"
            onClick={() => {
              if (!confirmDelete) return setConfirmDelete(true);
              update((p) => removeHolding(p, symbol));
              onClose();
            }}
            className="h-[52px] rounded-full border border-resistance-edge bg-surface px-4 text-sm text-down"
          >
            {confirmDelete ? "แตะอีกครั้งเพื่อลบ" : "ลบออกจากพอร์ต"}
          </button>
        )}
        <button
          type="submit"
          className="h-[52px] flex-1 rounded-full bg-ink text-[15px] font-medium text-surface shadow-pressed"
        >
          บันทึก
        </button>
      </div>
    </form>
  );
}

/**
 * Adds or edits one holding. Without a symbol it first asks which stock; a symbol already
 * in the portfolio opens that holding for editing.
 */
export function HoldingSheet({
  symbol: initial,
  onClose,
}: {
  symbol: string | null;
  onClose: () => void;
}) {
  const { portfolio } = usePortfolio();
  const [symbol, setSymbol] = useState(initial);
  const held = portfolio.holdings.map((h) => h.symbol);
  const existing = portfolio.holdings.find((h) => h.symbol === symbol) ?? null;
  const title = !symbol ? "เพิ่มหุ้นในพอร์ต" : existing ? "แก้หุ้นในพอร์ต" : "เพิ่มหุ้นในพอร์ต";

  return (
    <Sheet title={title} onClose={onClose}>
      {symbol ? (
        <HoldingForm
          key={symbol}
          symbol={symbol}
          existing={existing}
          onClose={onClose}
          onChangeSymbol={initial ? null : () => setSymbol(null)}
        />
      ) : (
        <SymbolPicker held={held} onPick={setSymbol} />
      )}
    </Sheet>
  );
}
