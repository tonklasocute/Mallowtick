"use client";

import { ArrowRight, Search, X } from "lucide-react";
import { useEffect, useRef } from "react";

interface SearchBoxProps {
  value: string;
  onChange: (value: string) => void;
}

export function SearchBox({ value, onChange }: SearchBoxProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // The watchlist's "add" action links to /#search.
  useEffect(() => {
    if (window.location.hash === "#search") inputRef.current?.focus();
  }, []);

  return (
    <form
      role="search"
      // Results update as you type; submitting just closes the on-screen keyboard.
      onSubmit={(e) => {
        e.preventDefault();
        inputRef.current?.blur();
      }}
      className="flex h-13 items-center gap-1 rounded-full border-[1.5px] border-line bg-surface pr-1.5 pl-4 shadow-soft focus-within:border-mint"
    >
      <label htmlFor="stock-search" className="sr-only">
        ค้นหาหุ้นสหรัฐฯ ด้วยชื่อย่อหรือชื่อบริษัท
      </label>
      <Search aria-hidden className="size-5 shrink-0 text-slate" strokeWidth={2.2} />
      <input
        ref={inputRef}
        id="stock-search"
        type="search"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={40}
        placeholder="ค้นหาชื่อย่อหุ้นหรือชื่อบริษัท"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onChange("")}
        className="h-full min-w-0 flex-1 bg-transparent pl-1.5 text-base text-ink placeholder:text-slate focus:outline-none"
      />
      {value && (
        <button
          type="button"
          aria-label="ล้างคำค้นหา"
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-slate hover:bg-cream-deep"
        >
          <X aria-hidden className="size-4" />
        </button>
      )}
      <button
        type="submit"
        aria-label="ค้นหา"
        className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-ink text-surface transition hover:bg-ink/90"
      >
        <ArrowRight aria-hidden className="size-4" strokeWidth={2.6} />
      </button>
    </form>
  );
}
