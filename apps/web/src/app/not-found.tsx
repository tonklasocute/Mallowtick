import Link from "next/link";

import { PageContainer } from "@/components/layout/page-container";
import { StateMessage } from "@/components/ui/state-message";

export default function NotFound() {
  return (
    <PageContainer>
      <main className="pt-safe pb-nav px-4 pt-16">
        <StateMessage
          title="Page not found"
          description="That ticker or page doesn't exist."
          action={
            <Link
              href="/"
              className="inline-flex min-h-10 items-center rounded-full bg-mint-soft px-4 text-sm font-semibold text-mint-deep"
            >
              Back to Discover
            </Link>
          }
        />
      </main>
    </PageContainer>
  );
}
