import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

import { WatchlistProvider } from "@/features/watchlist/use-watchlist";
import {
  MemoryWatchlistRepository,
  type WatchlistRepository,
} from "@/features/watchlist/watchlist-repository";

export function renderWithProviders(
  ui: ReactElement,
  opts: { repository?: WatchlistRepository } = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  });
  const repository = opts.repository ?? new MemoryWatchlistRepository();
  const result = render(
    <QueryClientProvider client={client}>
      <WatchlistProvider repository={repository}>{ui}</WatchlistProvider>
    </QueryClientProvider>,
  );
  return { ...result, client, repository };
}
