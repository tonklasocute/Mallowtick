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

import { EMPTY_PORTFOLIO, type Portfolio } from "./portfolio-model";
import type { PortfolioRepository } from "./portfolio-repository";

const RepositoryContext = createContext<PortfolioRepository | null>(null);

export function PortfolioProvider({
  repository,
  children,
}: {
  repository: PortfolioRepository;
  children: ReactNode;
}) {
  return <RepositoryContext.Provider value={repository}>{children}</RepositoryContext.Provider>;
}

function usePortfolioRepository(): PortfolioRepository {
  const repo = useContext(RepositoryContext);
  if (!repo) throw new Error("usePortfolio must be used inside <PortfolioProvider>");
  return repo;
}

const noSubscription = () => () => {};

/** Where the portfolio is stored, or null during SSR and hydration (see useStorageDescription). */
export function usePortfolioStorageDescription(): string | null {
  const repo = usePortfolioRepository();
  return useSyncExternalStore(
    noSubscription,
    () => repo.storageDescription,
    () => null,
  );
}

const PORTFOLIO_KEY = ["portfolio"] as const;

export interface PortfolioState {
  portfolio: Portfolio;
  isLoading: boolean;
  error: Error | null;
  /** Applies an update optimistically; a failed save reloads from storage. */
  update: (fn: (p: Portfolio) => Portfolio) => void;
}

export function usePortfolio(): PortfolioState {
  const repo = usePortfolioRepository();
  const client = useQueryClient();

  const query = useQuery({
    queryKey: PORTFOLIO_KEY,
    queryFn: () => repo.load(),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  useEffect(
    () => repo.subscribe(() => void client.invalidateQueries({ queryKey: PORTFOLIO_KEY })),
    [repo, client],
  );

  const mutation = useMutation({
    mutationFn: (fn: (p: Portfolio) => Portfolio) => {
      const next = fn(client.getQueryData<Portfolio>(PORTFOLIO_KEY) ?? EMPTY_PORTFOLIO);
      client.setQueryData(PORTFOLIO_KEY, next);
      return repo.save(next);
    },
    onError: () => void client.invalidateQueries({ queryKey: PORTFOLIO_KEY }),
  });

  const portfolio = query.data ?? EMPTY_PORTFOLIO;
  const { mutate } = mutation;
  return useMemo(
    () => ({
      portfolio,
      isLoading: query.isLoading,
      error: (mutation.error ?? query.error) as Error | null,
      update: mutate,
    }),
    [portfolio, query.isLoading, query.error, mutation.error, mutate],
  );
}
