"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

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

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(createQueryClient);
  const [repository] = useState(createRepository);
  return (
    <QueryClientProvider client={client}>
      <WatchlistProvider repository={repository}>{children}</WatchlistProvider>
    </QueryClientProvider>
  );
}
