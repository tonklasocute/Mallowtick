"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { addSymbol, removeSymbol, toggleSymbol } from "./watchlist-model";
import type { WatchlistRepository } from "./watchlist-repository";

const RepositoryContext = createContext<WatchlistRepository | null>(null);

export function WatchlistProvider({
  repository,
  children,
}: {
  repository: WatchlistRepository;
  children: ReactNode;
}) {
  return <RepositoryContext.Provider value={repository}>{children}</RepositoryContext.Provider>;
}

export function useWatchlistRepository(): WatchlistRepository {
  const repo = useContext(RepositoryContext);
  if (!repo) throw new Error("useWatchlist must be used inside <WatchlistProvider>");
  return repo;
}

const noSubscription = () => () => {};

/**
 * Where the watchlist is stored, or null during SSR and hydration: the server always uses the
 * in-memory repository, so rendering its description there would not match the browser.
 */
export function useStorageDescription(): string | null {
  const repo = useWatchlistRepository();
  return useSyncExternalStore(
    noSubscription,
    () => repo.storageDescription,
    () => null,
  );
}

const WATCHLIST_KEY = ["watchlist"] as const;

export interface Watchlist {
  symbols: string[];
  isLoading: boolean;
  error: Error | null;
  has: (symbol: string) => boolean;
  add: (symbol: string) => void;
  remove: (symbol: string) => void;
  toggle: (symbol: string) => void;
}

/** Reads and updates the watchlist with optimistic updates and rollback on failure. */
export function useWatchlist(): Watchlist {
  const repo = useWatchlistRepository();
  const client = useQueryClient();

  const query = useQuery({
    queryKey: WATCHLIST_KEY,
    queryFn: () => repo.list(),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  useEffect(
    () => repo.subscribe(() => void client.invalidateQueries({ queryKey: WATCHLIST_KEY })),
    [repo, client],
  );

  const mutation = useMutation({
    mutationFn: (update: (list: string[]) => string[]) => {
      const current = client.getQueryData<string[]>(WATCHLIST_KEY) ?? [];
      const next = update(current);
      client.setQueryData(WATCHLIST_KEY, next);
      return repo.save(next);
    },
    // Reload from storage so the optimistic update is rolled back.
    onError: () => void client.invalidateQueries({ queryKey: WATCHLIST_KEY }),
  });

  const symbols = useMemo(() => query.data ?? [], [query.data]);
  const { mutate } = mutation;

  return useMemo(
    () => ({
      symbols,
      isLoading: query.isLoading,
      error: (mutation.error ?? query.error) as Error | null,
      has: (s: string) => symbols.includes(s.toUpperCase()),
      add: (s: string) => mutate((list) => addSymbol(list, s)),
      remove: (s: string) => mutate((list) => removeSymbol(list, s)),
      toggle: (s: string) => mutate((list) => toggleSymbol(list, s)),
    }),
    [symbols, query.isLoading, query.error, mutation.error, mutate],
  );
}
