import type { Metadata } from "next";

import { CompareScreen } from "@/features/research/compare-screen";
import { MAX_COMPARE } from "@/lib/research";
import { normalizeSymbol } from "@/lib/symbols";

export const metadata: Metadata = { title: "เปรียบเทียบหุ้น" };

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ symbols?: string | string[] }>;
}) {
  const raw = (await searchParams).symbols;
  const initial =
    typeof raw === "string"
      ? [
          ...new Set(
            raw
              .split(",")
              .map(normalizeSymbol)
              .filter((s): s is string => !!s),
          ),
        ].slice(0, MAX_COMPARE)
      : [];
  return <CompareScreen initial={initial} />;
}
