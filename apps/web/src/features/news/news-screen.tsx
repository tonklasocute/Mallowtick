"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { BackButton } from "@/components/layout/back-button";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { StateMessage } from "@/components/ui/state-message";
import { useMySymbols } from "@/hooks/use-my-symbols";
import { cn } from "@/lib/cn";
import { normalizeSymbol } from "@/lib/symbols";
import { NEWS_MAX_SYMBOLS } from "@/services/api/queries";
import type { MarketNewsCategory } from "@/types/api";

import { NewsList } from "./news-list";

export type NewsTab = "for-you" | "market" | "company";

const TABS = [
  { value: "for-you", label: "สำหรับคุณ" },
  { value: "market", label: "ตลาด" },
  { value: "company", label: "บริษัท" },
] as const satisfies readonly { value: NewsTab; label: string }[];

const CATEGORIES: { value: MarketNewsCategory; label: string }[] = [
  { value: "general", label: "ข่าวตลาด" },
  { value: "merger", label: "ควบรวมกิจการ" },
];

function ForYou() {
  const mine = useMySymbols();
  if (mine.isLoading) return null;
  if (mine.all.length === 0) {
    return (
      <StateMessage
        title="ยังไม่มีหุ้นให้เลือกข่าว"
        description="เพิ่มหุ้นในพอร์ตหรือรายการที่สนใจ แล้วข่าวของหุ้นเหล่านั้นจะมาแสดงที่นี่"
        action={
          <Link href="/" className="text-sm font-medium text-mint-deep underline">
            ไปค้นหาหุ้น
          </Link>
        }
      />
    );
  }
  const symbols = mine.all.slice(0, NEWS_MAX_SYMBOLS);
  return (
    <div className="space-y-2.5">
      <p className="px-1 text-[12px] font-light text-slate">
        ข่าวของ {symbols.join(", ")}
        {mine.all.length > symbols.length &&
          ` (${NEWS_MAX_SYMBOLS} ตัวแรกจากพอร์ตและรายการที่สนใจ)`}{" "}
        · เลือกจากหุ้นที่บันทึกไว้ในเครื่องนี้
      </p>
      <NewsList symbols={symbols} emptyTitle="ยังไม่มีข่าวของหุ้นเหล่านี้ใน 7 วันที่ผ่านมา" />
    </div>
  );
}

function Market() {
  const [category, setCategory] = useState<MarketNewsCategory>("general");
  return (
    <div className="space-y-2.5">
      <div className="flex gap-2">
        {CATEGORIES.map((c) => (
          <button
            key={c.value}
            type="button"
            aria-pressed={category === c.value}
            onClick={() => setCategory(c.value)}
            className={cn(
              "min-h-9 rounded-full border px-3 text-[12.5px]",
              category === c.value
                ? "border-ink bg-ink text-surface"
                : "border-line bg-surface text-slate-strong",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>
      <NewsList category={category} />
    </div>
  );
}

function Company({ initialSymbol }: { initialSymbol: string | null }) {
  const [input, setInput] = useState(initialSymbol ?? "");
  const [symbol, setSymbol] = useState<string | null>(initialSymbol);
  const [invalid, setInvalid] = useState(false);
  return (
    <div className="space-y-2.5">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          const s = normalizeSymbol(input);
          setInvalid(!s);
          if (s) setSymbol(s);
        }}
        className="flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface py-1 pr-1 pl-4 focus-within:border-ink"
      >
        <Search aria-hidden className="size-4 text-slate" />
        <label className="sr-only" htmlFor="news-symbol">
          สัญลักษณ์หุ้น
        </label>
        <input
          id="news-symbol"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="สัญลักษณ์หุ้น เช่น AAPL"
          autoCapitalize="characters"
          className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-faint"
        />
        <button
          type="submit"
          className="min-h-9 rounded-full bg-ink px-4 text-[13px] font-medium text-surface"
        >
          ดูข่าว
        </button>
      </form>
      {invalid && (
        <p role="alert" className="px-1 text-xs text-down">
          สัญลักษณ์หุ้นไม่ถูกต้อง
        </p>
      )}
      {symbol ? (
        <NewsList
          key={symbol}
          symbols={[symbol]}
          emptyTitle={`ยังไม่มีข่าวของ ${symbol} ใน 7 วันที่ผ่านมา`}
        />
      ) : (
        <StateMessage title="ใส่สัญลักษณ์หุ้นเพื่อดูข่าวของบริษัท" />
      )}
    </div>
  );
}

export function NewsScreen({
  initialTab = "for-you",
  initialSymbol = null,
}: {
  initialTab?: NewsTab;
  initialSymbol?: string | null;
}) {
  const [tab, setTab] = useState<NewsTab>(initialSymbol ? "company" : initialTab);
  return (
    <PageContainer>
      <PageHeader leading={<BackButton />} title="ข่าว" />
      <main className="pb-nav space-y-3.5 px-4">
        <SegmentedControl label="ประเภทข่าว" options={TABS} value={tab} onChange={setTab} />
        {tab === "for-you" && <ForYou />}
        {tab === "market" && <Market />}
        {tab === "company" && <Company initialSymbol={initialSymbol} />}
      </main>
    </PageContainer>
  );
}
