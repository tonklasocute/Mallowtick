import type { Metadata } from "next";
import Link from "next/link";

import { PageContainer } from "@/components/layout/page-container";
import { StateMessage } from "@/components/ui/state-message";

export const metadata: Metadata = { title: "Offline" };

/** Precached by the service worker and shown when a page can't be loaded offline. */
export default function OfflinePage() {
  return (
    <PageContainer>
      <main className="pt-safe pb-nav px-4 pt-16">
        <StateMessage
          title="You're offline"
          description="Market data needs a connection. Mallowtick never shows cached prices as live — reconnect to see current quotes."
          action={
            <Link
              href="/"
              className="inline-flex min-h-10 items-center rounded-full bg-mint-soft px-4 text-sm font-semibold text-mint-deep"
            >
              Try again
            </Link>
          }
        />
      </main>
    </PageContainer>
  );
}
