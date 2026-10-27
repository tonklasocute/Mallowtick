"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import {
  LocalStoragePortfolioRepository,
  MemoryPortfolioRepository,
  type PortfolioRepository,
} from "@/features/portfolio/portfolio-repository";
import { PortfolioProvider } from "@/features/portfolio/use-portfolio";
import {
  LocalStorageWatchlistRepository,
  MemoryWatchlistRepository,
  type WatchlistRepository,
} from "@/features/watchlist/watchlist-repository";
import { WatchlistProvider } from "@/features/watchlist/use-watchlist";
import { createQueryClient } from "@/services/api/queries";

function createRepository(): WatchlistRepository {
  try {
    if (typeof window !== "undefined" && window.localStorage)
      return new LocalStorageWatchlistRepository();
  } catch {
    // Storage can be blocked (e.g. strict privacy settings); fall back to memory.
  }
  return new MemoryWatchlistRepository();
}

function createPortfolioRepository(): PortfolioRepository {
  try {
    if (typeof window !== "undefined" && window.localStorage)
      return new LocalStoragePortfolioRepository();
  } catch {
    // Same fallback as the watchlist.
  }
  return new MemoryPortfolioRepository();
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(createQueryClient);
  const [repository] = useState(createRepository);
  const [portfolio] = useState(createPortfolioRepository);
  return (
    <QueryClientProvider client={client}>
      <WatchlistProvider repository={repository}>
        <PortfolioProvider repository={portfolio}>{children}</PortfolioProvider>
      </WatchlistProvider>
    </QueryClientProvider>
  );
}
