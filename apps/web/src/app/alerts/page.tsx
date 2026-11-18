import type { Metadata } from "next";

import { AlertsScreen } from "@/features/alerts/alerts-screen";
import { normalizeSymbol } from "@/lib/symbols";

export const metadata: Metadata = { title: "การแจ้งเตือน" };

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string | string[] }>;
}) {
  const raw = (await searchParams).new;
  const newFor = typeof raw === "string" ? (normalizeSymbol(raw) ?? "") : null;
  return <AlertsScreen newFor={newFor} />;
}
