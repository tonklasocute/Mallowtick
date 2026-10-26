import type { Metadata } from "next";

import { WatchlistScreen } from "@/features/watchlist/watchlist-screen";

export const metadata: Metadata = { title: "หุ้นที่สนใจ" };

export default function WatchlistPage() {
  return <WatchlistScreen />;
}
