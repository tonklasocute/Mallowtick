"use client";

import { Download, Info, Database, Smartphone } from "lucide-react";
import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";

import { Mascot } from "@/components/brand/mascot";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { errorCopy } from "@/components/market/api-error-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useWatchlistRepository } from "@/features/watchlist/use-watchlist";
import { BRAND } from "@/lib/brand";
import { useHealth } from "@/services/api/queries";
import type { Latency } from "@/types/api";

const LATENCY_COPY: Record<Latency, string> = {
  realtime: "Real-time (as declared for the configured plan)",
  delayed: "Delayed",
  eod: "End of day",
  unknown: "Not declared — prices are labelled with their timestamps only",
};

function subscribeDisplayMode(onChange: () => void) {
  const mq = window.matchMedia("(display-mode: standalone)");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function useIsStandalone(): boolean {
  return useSyncExternalStore(
    subscribeDisplayMode,
    () =>
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
    () => false,
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <div className="mb-2 flex items-center gap-2 text-mint-deep">
        {icon}
        <CardTitle>{title}</CardTitle>
      </div>
      <div className="space-y-2 text-sm text-slate-strong">{children}</div>
    </Card>
  );
}

function ProviderStatus() {
  const { data, error, isPending } = useHealth();
  if (isPending) return <Skeleton className="h-10 w-full" />;
  if (!data) return <p>{errorCopy(error).title}.</p>;
  const { provider } = data;
  return (
    <dl className="space-y-1.5">
      <div className="flex justify-between gap-3">
        <dt>Provider</dt>
        <dd className="font-semibold text-ink">
          {provider.name === "twelvedata" ? "Twelve Data" : provider.name}
        </dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt>Status</dt>
        <dd>
          {provider.configured ? (
            <Badge tone="mint">Configured</Badge>
          ) : (
            <Badge tone="accent">Not configured</Badge>
          )}
        </dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt>Data latency</dt>
        <dd className="text-right font-semibold text-ink">{LATENCY_COPY[provider.latency]}</dd>
      </div>
    </dl>
  );
}

export function MoreScreen() {
  const repo = useWatchlistRepository();
  const standalone = useIsStandalone();
  return (
    <PageContainer>
      <PageHeader title="More" />
      <main className="pb-nav space-y-4 px-4">
        <Section icon={<Database aria-hidden className="size-5" />} title="Market data">
          <ProviderStatus />
          <p className="text-xs text-slate">
            Quotes refresh while a screen is open. Every price shows its provider timestamp; cached
            or offline data is marked stale and never shown as live.
          </p>
        </Section>

        <Section icon={<Smartphone aria-hidden className="size-5" />} title="Watchlist storage">
          <p>{repo.storageDescription}</p>
        </Section>

        <Section icon={<Download aria-hidden className="size-5" />} title="Install on iPhone">
          {standalone ? (
            <p>Mallowtick is installed on this device. 🎉</p>
          ) : (
            <ol className="list-decimal space-y-1 pl-5">
              <li>Open Mallowtick in Safari.</li>
              <li>Tap the Share button.</li>
              <li>Choose “Add to Home Screen”.</li>
            </ol>
          )}
        </Section>

        <Section icon={<Info aria-hidden className="size-5" />} title="About">
          <div className="flex items-center gap-3">
            <Mascot size={44} />
            <div>
              <p className="font-display font-semibold text-ink">{BRAND.name}</p>
              <p className="text-xs">{BRAND.tagline}</p>
            </div>
          </div>
          <p className="text-xs text-slate">
            For information only, not investment advice. Support and resistance levels are
            calculated estimates and do not predict future prices. Market data by Twelve Data.
            Charts by TradingView Lightweight Charts™.
          </p>
        </Section>
      </main>
    </PageContainer>
  );
}
