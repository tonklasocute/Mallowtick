import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

import { type AlertStore, MemoryAlertStore } from "@/features/alerts/alert-store";
import { AlertsProvider } from "@/features/alerts/use-alerts";
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
  opts: {
    repository?: WatchlistRepository;
    portfolio?: Portfolio;
    alerts?: AlertStore;
    /** Resolves the alert store when the test says so (default: at once). */
    openAlerts?: Promise<void>;
  } = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  });
  const repository = opts.repository ?? new MemoryWatchlistRepository();
  const portfolio = new MemoryPortfolioRepository(opts.portfolio);
  const alerts = opts.alerts ?? new MemoryAlertStore();
  const createStore = () => (opts.openAlerts ?? Promise.resolve()).then(() => alerts);
  const result = render(
    <QueryClientProvider client={client}>
      <WatchlistProvider repository={repository}>
        <PortfolioProvider repository={portfolio}>
          <AlertsProvider createStore={createStore}>{ui}</AlertsProvider>
        </PortfolioProvider>
      </WatchlistProvider>
    </QueryClientProvider>,
  );
  return { ...result, client, repository, portfolio, alerts };
}
