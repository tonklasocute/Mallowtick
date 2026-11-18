"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";

import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/cn";
import { formatPrice } from "@/lib/format";
import { normalizeSymbol } from "@/lib/symbols";
import type { Quote } from "@/types/api";

import {
  ALERT_TYPES,
  type AlertType,
  COOLDOWN_OPTIONS,
  cooldownLabel,
  defaultCooldown,
} from "./alert-model";
import { useAlerts } from "./use-alerts";

const HINTS: Record<AlertType, string> = {
  price_above: "แจ้งเมื่อราคาขึ้นมาอยู่ที่หรือสูงกว่าระดับนี้",
  price_below: "แจ้งเมื่อราคาลงมาอยู่ที่หรือต่ำกว่าระดับนี้",
  cross_above: "แจ้งเมื่อเห็นราคาอยู่ใต้ระดับนี้ก่อน แล้วขึ้นมาเหนือระดับ",
  cross_below: "แจ้งเมื่อเห็นราคาอยู่เหนือระดับนี้ก่อน แล้วลงมาใต้ระดับ",
  percent_move: "แจ้งเมื่อราคาวันนี้เปลี่ยนจากราคาปิดก่อนหน้าเกินเปอร์เซ็นต์นี้ ขึ้นหรือลง",
  earnings_upcoming: "แจ้งเมื่อวันประกาศงบอยู่ภายในจำนวนวันนี้ (0 = เฉพาะวันประกาศ)",
  company_news: "แจ้งเมื่อมีข่าวใหม่ของบริษัทหลังจากตั้งการแจ้งเตือนนี้",
};

const DEFAULT_THRESHOLD: Partial<Record<AlertType, string>> = {
  percent_move: "3",
  earnings_upcoming: "7",
};

/** Creates an alert rule; rules are saved on this device only. */
export function AlertRuleSheet({
  initialSymbol = "",
  onClose,
}: {
  initialSymbol?: string;
  onClose: () => void;
}) {
  const alerts = useAlerts();
  const client = useQueryClient();
  const id = useId();
  const [symbol, setSymbol] = useState(initialSymbol);
  const [type, setType] = useState<AlertType>("price_above");
  const [threshold, setThreshold] = useState("");
  const [cooldown, setCooldown] = useState<number>(defaultCooldown("price_above"));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const meta = ALERT_TYPES.find((t) => t.type === type)!;
  const normalized = normalizeSymbol(symbol);
  // The last price the app already has; never fetched just for this hint.
  const cached = normalized ? client.getQueryData<Quote>(["quote", normalized]) : undefined;

  const pickType = (t: AlertType) => {
    setType(t);
    setThreshold(DEFAULT_THRESHOLD[t] ?? "");
    setCooldown(defaultCooldown(t));
    setError(null);
  };

  const save = async () => {
    setSaving(true);
    const value = threshold.trim() === "" ? null : Number(threshold.replace(/,/g, ""));
    const err = await alerts.addRule({
      symbol,
      type,
      threshold: value !== null && Number.isFinite(value) ? value : null,
      cooldownMinutes: cooldown,
    });
    setSaving(false);
    if (err) setError(err);
    else onClose();
  };

  return (
    <Sheet
      title="ตั้งการแจ้งเตือน"
      onClose={onClose}
      footer={
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || !alerts.ready}
          className="min-h-12 w-full rounded-full bg-ink text-[15px] font-medium text-surface disabled:opacity-50"
        >
          บันทึกการแจ้งเตือน
        </button>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="space-y-1.5">
          <label htmlFor={`${id}-symbol`} className="text-sm font-medium text-ink">
            หุ้น
          </label>
          <input
            id={`${id}-symbol`}
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            placeholder="เช่น AAPL"
            autoCapitalize="characters"
            className="h-12 w-full rounded-2xl border border-line bg-surface px-4 font-display text-[15px] font-bold text-ink uppercase outline-none focus:border-ink"
          />
          {cached && (
            <p className="text-[12px] text-slate">
              ราคาล่าสุดที่แอปมี {formatPrice(cached.price, cached.currency)}
            </p>
          )}
        </div>

        <fieldset className="space-y-1.5">
          <legend className="mb-1.5 text-sm font-medium text-ink">แจ้งเมื่อ</legend>
          <div className="grid grid-cols-2 gap-1.5">
            {ALERT_TYPES.map((t) => (
              <label
                key={t.type}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center rounded-2xl border px-3 text-[13px]",
                  type === t.type
                    ? "border-ink bg-ink font-medium text-surface"
                    : "border-line bg-surface text-slate-strong",
                )}
              >
                <input
                  type="radio"
                  name={`${id}-type`}
                  value={t.type}
                  checked={type === t.type}
                  onChange={() => pickType(t.type)}
                  className="sr-only"
                />
                {t.label}
              </label>
            ))}
          </div>
          <p className="text-[12px] leading-relaxed text-slate">{HINTS[type]}</p>
        </fieldset>

        {meta.unit && (
          <div className="space-y-1.5">
            <label htmlFor={`${id}-threshold`} className="text-sm font-medium text-ink">
              {meta.unit === "USD" ? "ราคา (USD)" : meta.unit === "%" ? "เปอร์เซ็นต์" : "จำนวนวัน"}
            </label>
            <input
              id={`${id}-threshold`}
              inputMode="decimal"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              className="tabular h-12 w-full rounded-2xl border border-line bg-surface px-4 font-display text-[15px] font-bold text-ink outline-none focus:border-ink"
            />
          </div>
        )}

        {type !== "earnings_upcoming" && type !== "company_news" && (
          <div className="space-y-1.5">
            <label htmlFor={`${id}-cooldown`} className="text-sm font-medium text-ink">
              พักระหว่างการแจ้งเตือน
            </label>
            <select
              id={`${id}-cooldown`}
              value={cooldown}
              onChange={(e) => setCooldown(Number(e.target.value))}
              className="h-12 w-full rounded-2xl border border-line bg-surface px-4 text-sm text-ink"
            >
              {COOLDOWN_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {cooldownLabel(m)}
                </option>
              ))}
            </select>
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-xl bg-accent-soft px-3 py-2 text-sm text-down">
            {error}
          </p>
        )}
      </form>
    </Sheet>
  );
}
