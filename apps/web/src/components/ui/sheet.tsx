"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";

import { cn } from "@/lib/cn";

interface SheetProps {
  title: ReactNode;
  onClose: () => void;
  /** Pinned under the scrolling content, e.g. the save button. */
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * A modal bottom sheet on phones and a centred dialog on larger screens, as the EMA
 * settings sheet does: focus stays inside, Escape and the backdrop close it.
 */
export function Sheet({ title, onClose, footer, children, className }: SheetProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const first = panelRef.current?.querySelector<HTMLElement>("input, button:not([data-close])");
    first?.focus();
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !panelRef.current) return;
    const items = panelRef.current.querySelectorAll<HTMLElement>(
      "a[href], button:not([disabled]), input:not([disabled])",
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

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-ink/45 md:items-center"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        className={cn(
          "flex max-h-[92dvh] w-full max-w-md flex-col rounded-t-[1.875rem] bg-cream shadow-float md:rounded-panel",
          className,
        )}
      >
        <span
          aria-hidden
          className="mx-auto mt-2.5 h-[5px] w-11 shrink-0 rounded-full bg-line-strong md:hidden"
        />
        <div className="flex shrink-0 items-center justify-between gap-2 px-4 pt-2 pb-3">
          <h2 id={titleId} className="min-w-0 truncate text-[19px] font-medium text-ink">
            {title}
          </h2>
          <button
            type="button"
            data-close
            aria-label="ปิด"
            onClick={onClose}
            className="grid size-11 shrink-0 place-items-center rounded-full border border-line bg-surface text-ink"
          >
            <X aria-hidden className="size-[18px]" strokeWidth={2.2} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>
        {footer && (
          <div className="shrink-0 border-t border-line px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
