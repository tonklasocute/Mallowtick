import type { Metadata } from "next";

import { MoreScreen } from "@/features/more/more-screen";

export const metadata: Metadata = { title: "เพิ่มเติม" };

export default function MorePage() {
  return <MoreScreen />;
}
