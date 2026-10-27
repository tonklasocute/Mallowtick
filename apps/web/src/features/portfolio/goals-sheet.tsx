"use client";

import { Target } from "lucide-react";
import { useId, useState } from "react";

import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/cn";

import {
  convert,
  type Currency,
  formatMoney,
  parseDecimal,
  type PortfolioValuation,
} from "./portfolio-model";
import { usePortfolio } from "./use-portfolio";

/** Round amounts people pick from, per currency. */
const PRESETS: Record<Currency, number[]> = {
  THB: [500_000, 1_000_000, 2_000_000, 5_000_000],
  USD: [10_000, 25_000, 50_000, 100_000],
};

const short = (v: number, currency: Currency) => {
  const sign = currency === "THB" ? "฿" : "$";
  return v >= 1_000_000 ? `${sign}${v / 1_000_000}M` : `${sign}${v / 1000}K`;
};

/** The portfolio's value goal: a preset or a typed amount, with the progress shown live. */
export function GoalsSheet({
  valuation,
  rate,
  onClose,
}: {
  valuation: PortfolioValuation;
  rate: number | null;
  onClose: () => void;
}) {
  const { portfolio, update } = usePortfolio();
  const inputId = useId();
  const [currency, setCurrency] = useState<Currency>(
    portfolio.goal?.currency ?? valuation.currency,
  );
  const [goal, setGoal] = useState<number | null>(portfolio.goal?.amount ?? null);
  const [custom, setCustom] = useState("");

  const switchCurrency = (next: Currency) => {
    if (next === currency) return;
    const converted = goal === null ? null : convert(goal, currency, next, rate);
    setCurrency(next);
    setGoal(converted === null ? null : Math.round(converted));
    setCustom("");
  };
  const typed = parseDecimal(custom);
  const typedError = typed !== null && (Number.isNaN(typed) || typed <= 0);

  const now = convert(valuation.total, valuation.currency, currency, rate);
  const reached = goal && now !== null ? Math.min((now / goal) * 100, 100) : null;

  const save = () => {
    if (typedError) return;
    const amount = typed ?? goal;
    update((p) => ({ ...p, goal: amount ? { amount, currency } : null }));
    onClose();
  };

  const chip = (on: boolean) =>
    cn(
      "h-11 rounded-[14px] font-display text-[13.5px] font-extrabold",
      on ? "bg-spot-up text-spot-deep" : "border border-surface/20 text-spot-text",
    );

  return (
    <Sheet
      title="ตั้งเป้าหมาย"
      onClose={onClose}
      footer={
        <button
          type="button"
          onClick={save}
          disabled={typedError}
          className="h-[54px] w-full rounded-full bg-ink text-[15px] font-medium text-surface shadow-pressed disabled:opacity-50"
        >
          บันทึกเป้าหมาย
        </button>
      }
    >
      <section
        aria-labelledby={`${inputId}-goal`}
        className="relative flex flex-col gap-3 overflow-hidden rounded-3xl bg-ink p-4 text-surface"
      >
        <span
          aria-hidden
          className="absolute -top-[70px] -right-[60px] size-[170px] rounded-full border-2 border-dashed border-heat-4/35"
        />
        <div className="relative flex items-center justify-between gap-2">
          <h3 id={`${inputId}-goal`} className="flex items-center gap-2 text-[15px] font-medium">
            <span
              aria-hidden
              className="grid size-7 place-items-center rounded-[9px] bg-gold text-honey-ink"
            >
              <Target className="size-[15px]" strokeWidth={2.4} />
            </span>
            อยากให้พอร์ตมีมูลค่า
          </h3>
          <div
            role="group"
            aria-label="สกุลเงินของเป้า"
            className="flex gap-0.5 rounded-full bg-surface/10 p-[3px]"
          >
            {(["THB", "USD"] as const).map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={currency === c}
                onClick={() => switchCurrency(c)}
                className={cn(
                  "h-[34px] rounded-full px-3 font-display text-[13px] font-extrabold",
                  currency === c ? "bg-spot-up text-spot-deep" : "text-spot-soft",
                )}
              >
                {c === "THB" ? "฿" : "$"}
              </button>
            ))}
          </div>
        </div>
        <span className="tabular relative font-display text-[40px] leading-none font-black tracking-[-1px] text-spot-up">
          {typed && !typedError
            ? formatMoney(typed, currency)
            : goal
              ? formatMoney(goal, currency)
              : "ยังไม่ได้ตั้ง"}
        </span>
        <div className="relative grid grid-cols-4 gap-1.5">
          {PRESETS[currency].map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={goal === v && !custom}
              onClick={() => {
                setGoal(v);
                setCustom("");
              }}
              className={chip(goal === v && !custom)}
            >
              {short(v, currency)}
            </button>
          ))}
        </div>
        <label
          htmlFor={inputId}
          className="relative flex h-11 items-center gap-2 rounded-[14px] bg-surface/8 px-3 text-xs text-spot-soft"
        >
          ใส่เอง
          <input
            id={inputId}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder={currency === "THB" ? "เช่น 3,000,000" : "เช่น 80,000"}
            aria-invalid={typedError}
            className="tabular h-10 min-w-0 flex-1 bg-transparent font-display text-[15px] font-extrabold text-surface outline-none placeholder:font-sans placeholder:text-xs placeholder:font-light placeholder:text-spot-muted"
          />
        </label>
        {typedError && <span className="relative text-xs text-heat-1">ใส่ตัวเลขที่มากกว่า 0</span>}
        {reached !== null && now !== null && (
          <div className="relative flex flex-col gap-1.5">
            <span aria-hidden className="relative h-3 overflow-hidden rounded-full bg-surface/12">
              <span
                className="absolute inset-y-0 left-0 rounded-full bg-spot-up"
                style={{ width: `${reached}%` }}
              />
            </span>
            <span className="flex justify-between text-xs text-spot-soft">
              <span>
                ตอนนี้ {formatMoney(now, currency)} ·{" "}
                <b className="font-display text-[13px] font-black text-surface">
                  {reached.toFixed(1)}%
                </b>
              </span>
              <span>
                {reached >= 100
                  ? "ถึงเป้าแล้ว"
                  : `ต้องโตอีก +${((((typed && !typedError ? typed : goal!) - now) / now) * 100).toFixed(0)}%`}
              </span>
            </span>
          </div>
        )}
      </section>
    </Sheet>
  );
}
