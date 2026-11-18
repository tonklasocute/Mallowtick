import type { Metadata } from "next";

import { BriefingScreen } from "@/features/research/briefing-screen";

export const metadata: Metadata = { title: "สรุปตลาดวันนี้" };

export default function BriefingPage() {
  return <BriefingScreen />;
}
