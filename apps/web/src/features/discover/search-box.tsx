"use client";

import { Search, X } from "lucide-react";
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
    <form role="search" onSubmit={(e) => e.preventDefault()} className="relative">
      <label htmlFor="stock-search" className="sr-only">
        Search US stocks by ticker or company name
      </label>
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-slate"
      />
      <input
        ref={inputRef}
        id="stock-search"
        type="search"
        inputMode="search"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={40}
        placeholder="Search ticker or company"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onChange("")}
        className="h-12 w-full rounded-2xl border border-line bg-surface pr-11 pl-10 text-base text-ink shadow-soft placeholder:text-slate focus:border-mint focus:outline-none"
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
          className="absolute top-1/2 right-1.5 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-full text-slate hover:bg-cream-deep"
        >
          <X aria-hidden className="size-4" />
        </button>
      )}
    </form>
  );
}
