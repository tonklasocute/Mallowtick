import type { Metadata } from "next";
import Link from "next/link";

import { PageContainer } from "@/components/layout/page-container";
import { StateMessage } from "@/components/ui/state-message";

export const metadata: Metadata = { title: "ออฟไลน์" };

/** Precached by the service worker and shown when a page can't be loaded offline. */
export default function OfflinePage() {
  return (
    <PageContainer>
      <main className="pt-safe pb-nav px-4 pt-16">
        <StateMessage
          title="คุณออฟไลน์อยู่"
          description="ต้องเชื่อมต่ออินเทอร์เน็ตเพื่อดูข้อมูลตลาด Mallowtick จะไม่แสดงราคาที่แคชไว้ว่าเป็นราคาล่าสุด เชื่อมต่อใหม่เพื่อดูราคาปัจจุบัน"
          action={
            <Link
              href="/"
              className="inline-flex min-h-10 items-center rounded-full bg-mint-soft px-4 text-sm font-semibold text-mint-deep"
            >
              ลองใหม่
            </Link>
          }
        />
      </main>
    </PageContainer>
  );
}
