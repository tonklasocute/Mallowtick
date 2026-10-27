"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { EMA_MAX_PERIOD, EMA_MIN_PERIOD } from "@/lib/ema";

import { DEFAULT_CHART_PREFS, isValidPeriod, type EmaLineSetting } from "./chart-prefs";

/** One colour per EMA slot; names are design tokens in globals.css. */
export const EMA_COLOR_TOKENS = [
  { name: "ema-1", fallback: "#f2a31f" },
  { name: "ema-2", fallback: "#3fa7e8" },
  { name: "ema-3", fallback: "#9b7bf0" },
  { name: "ema-4", fallback: "#ec6fae" },
] as const;

interface Draft {
  period: string;
  enabled: boolean;
}

const toDraft = (lines: EmaLineSetting[]): Draft[] =>
  lines.map((l) => ({ period: String(l.period), enabled: l.enabled }));

interface EmaSettingsSheetProps {
  value: EmaLineSetting[];
  onSave: (lines: EmaLineSetting[]) => void;
  onClose: () => void;
}

/** Bottom sheet on phones, centred dialog on larger screens. */
export function EmaSettingsSheet({ value, onSave, onClose }: EmaSettingsSheetProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState(() => toDraft(value));
  const invalid = draft.map((d) => !isValidPeriod(Number(d.period)));

  useEffect(() => {
    panelRef.current?.querySelector<HTMLInputElement>("input[type=number]")?.focus();
  }, []);

  // Keep keyboard focus inside the dialog and close on Escape.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !panelRef.current) return;
    const items = panelRef.current.querySelectorAll<HTMLElement>(
      "button:not([disabled]), input:not([disabled])",
    );
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  };

  const update = (i: number, patch: Partial<Draft>) =>
    setDraft((d) => d.map((row, j) => (j === i ? { ...row, ...patch } : row)));

  const save = () => {
    if (invalid.some(Boolean)) return;
    onSave(draft.map((d) => ({ period: Number(d.period), enabled: d.enabled })));
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-ink/25 md:items-center"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        className="w-full max-w-md rounded-t-[1.75rem] bg-surface p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-soft md:max-w-sm md:rounded-card md:pb-5"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id={titleId} className="font-display text-lg font-bold text-ink">
            ตั้งค่าเส้น EMA
          </h2>
          <button
            type="button"
            aria-label="ปิด"
            onClick={onClose}
            className="inline-flex size-9 items-center justify-center rounded-full text-slate-strong hover:bg-cream-deep"
          >
            <X aria-hidden className="size-5" />
          </button>
        </div>

        <ul className="space-y-2">
          {draft.map((row, i) => {
            const color = EMA_COLOR_TOKENS[i]!.name;
            const inputId = `${titleId}-period-${i}`;
            return (
              <li
                key={color}
                className={cn(
                  "flex items-center gap-3 rounded-2xl bg-cream px-3 py-2",
                  !row.enabled && "opacity-60",
                )}
              >
                <span
                  aria-hidden
                  className="h-1 w-5 shrink-0 rounded-full"
                  style={{ backgroundColor: `var(--color-${color})` }}
                />
                <label htmlFor={inputId} className="flex-1 text-sm font-semibold text-ink">
                  เส้นที่ {i + 1}
                </label>
                <input
                  id={inputId}
                  type="number"
                  inputMode="numeric"
                  min={EMA_MIN_PERIOD}
                  max={EMA_MAX_PERIOD}
                  step={1}
                  value={row.period}
                  aria-invalid={invalid[i]}
                  onChange={(e) => update(i, { period: e.target.value })}
                  className={cn(
                    "tabular h-10 w-20 [appearance:textfield] rounded-xl border bg-surface px-3 text-right text-base font-semibold text-ink focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
                    invalid[i] ? "border-down" : "border-line focus:border-mint",
                  )}
                />
                <span className="text-sm text-slate">แท่ง</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={row.enabled}
                  aria-label={`แสดงเส้นที่ ${i + 1}`}
                  onClick={() => update(i, { enabled: !row.enabled })}
                  className={cn(
                    "relative h-6 w-10 shrink-0 rounded-full transition-colors",
                    row.enabled ? "bg-mint-deep" : "bg-slate/25",
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-1 size-4 rounded-full bg-surface shadow-soft transition-[left]",
                      row.enabled ? "left-5" : "left-1",
                    )}
                  />
                </button>
              </li>
            );
          })}
        </ul>

        <p className={cn("mt-3 text-xs", invalid.some(Boolean) ? "text-down" : "text-slate")}>
          ใส่ได้ {EMA_MIN_PERIOD}–{EMA_MAX_PERIOD} แท่ง คำนวณจากแท่งของกราฟที่เลือกอยู่
        </p>

        <div className="mt-4 flex gap-2">
          <Button
            variant="ghost"
            className="flex-1 border border-line"
            onClick={() => setDraft(toDraft(DEFAULT_CHART_PREFS.ema))}
          >
            คืนค่าเริ่มต้น
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            disabled={invalid.some(Boolean)}
            onClick={save}
          >
            บันทึก
          </Button>
        </div>
      </div>
    </div>
  );
}
