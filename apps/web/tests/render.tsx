import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

import type { Portfolio } from "@/features/portfolio/portfolio-model";
import { MemoryPortfolioRepository } from "@/features/portfolio/portfolio-repository";
import { PortfolioProvider } from "@/features/portfolio/use-portfolio";
import { WatchlistProvider } from "@/features/watchlist/use-watchlist";
import {
  MemoryWatchlistRepository,
  type WatchlistRepository,
} from "@/features/watchlist/watchlist-repository";

export function renderWithProviders(
  ui: ReactElement,
  opts: { repository?: WatchlistRepository; portfolio?: Portfolio } = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  });
  const repository = opts.repository ?? new MemoryWatchlistRepository();
  const portfolio = new MemoryPortfolioRepository(opts.portfolio);
  const result = render(
    <QueryClientProvider client={client}>
      <WatchlistProvider repository={repository}>
        <PortfolioProvider repository={portfolio}>{ui}</PortfolioProvider>
      </WatchlistProvider>
    </QueryClientProvider>,
  );
  return { ...result, client, repository, portfolio };
}
