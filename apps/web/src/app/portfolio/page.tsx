import type { Metadata } from "next";

import { PortfolioScreen } from "@/features/portfolio/portfolio-screen";

export const metadata: Metadata = { title: "พอร์ตของฉัน" };

export default function PortfolioPage() {
  return <PortfolioScreen />;
}
