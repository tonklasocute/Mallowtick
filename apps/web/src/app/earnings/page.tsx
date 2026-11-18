import type { Metadata } from "next";

import { EarningsScreen } from "@/features/earnings/earnings-screen";

export const metadata: Metadata = { title: "ปฏิทินประกาศงบ" };

export default function EarningsPage() {
  return <EarningsScreen />;
}
