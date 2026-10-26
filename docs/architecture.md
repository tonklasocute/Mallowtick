# Architecture

```text
iPhone Safari / installed PWA
        │  same origin
        ▼
apps/web  (Next.js App Router)
  pages + client features ──► TanStack Query hooks ──► typed API client ──► /api/v1/* proxy route
        │                                                                         │ API_ORIGIN (server-only)
        ▼                                                                         ▼
  service worker (static/shell caching only)                  services/api  (Go + Gin)
                                                                transport/http ─► market.Service ─► market.Provider
                                                                                   │  cache, singleflight,      │
                                                                                   │  freshness, stale fallback ▼
                                                                                   └► supportresistance   twelvedata adapter ─► Twelve Data REST
```

## Backend (`services/api`)

| Package | Responsibility |
|---|---|
| `cmd/api` | Wiring, structured logging (slog), graceful shutdown on SIGINT/SIGTERM, embedded tzdata. |
| `internal/config` | Reads env vars and validates them all at startup; reports every invalid value together. |
| `internal/market` | Vendor-independent domain types, input validation (`Symbol`, `Range`), the `Provider` interface, error sentinels and codes, and `Service` (caching, request de-duplication, freshness, stale fallback, overview, levels). |
| `internal/market/twelvedata` | Provider adapter: auth header, local credit limiter, response parsing, error mapping. |
| `internal/supportresistance` | Pure, deterministic level calculation. |
| `internal/cache` | Small generic TTL cache that keeps expired entries for fallback. |
| `internal/transport/http` | Gin router, middleware (request ID, logging, recovery, CORS, timeout, no-store), handlers, envelope, error mapping. |

Design choices:

- **Provider-specific code stays in the adapter.** Handlers depend on a `MarketService` interface. The service depends on `market.Provider`.
- **Starts without credentials.** `market.Unconfigured` returns `ErrNotConfigured`, so the server runs and every data endpoint answers `provider_not_configured`. No substitute data exists anywhere in the code.
- **No database.** V1 has no durable server-side state: the watchlist is client-side and market data is cached in memory. PostgreSQL would come with accounts or server-side watchlists.
- **Concurrency.** Caches are mutex-guarded. Provider calls go through `singleflight` and are detached from the first caller's cancellation (bounded by the provider timeout), so concurrent waiters still get the result. Tests run with `-race`.

## Frontend (`apps/web`)

| Path | Responsibility |
|---|---|
| `src/app` | Routes (`/`, `/stocks/[symbol]`, `/watchlist`, `/more`, `/offline`), root layout, providers, `manifest.ts`, API proxy route. |
| `src/features/*` | Screen-level components: discover, stock-detail, watchlist (plus storage), more. |
| `src/components/*` | Reusable UI: `ui` primitives, `layout`, `brand`, `market`, `stocks`, `charts`. |
| `src/services/api` | `client.ts` (envelope → `ApiError`), `endpoints.ts`, `queries.ts` (query keys, polling, quote sharing). |
| `src/lib` | Formatting, freshness labelling, exchange-time conversion, level labelling, config. |
| `src/styles/globals.css` | Design tokens (`@theme`) — the only place colors are defined. |
| `src/types/api.ts` | TypeScript mirror of the API responses. |

Layout: phones and tablets use the bottom nav. Large screens (≥1024px) use a fixed sidebar (`SideNav`); both read `components/layout/nav-items.ts`. Screens wrap their content in `PageContainer`, which is `narrow` for single-column screens and `wide` for Discover. Discover switches to a two-column layout (benchmarks | popular stocks) on desktop. Response shaping for Discover lives in `features/discover/overview-model.ts`, not in components.

Data flow rules:

- Components never call `fetch`. They use hooks from `services/api/queries.ts`.
- Quote state is cached per symbol under one TanStack Query key. Batch responses (overview, watchlist) seed those per-symbol entries, so Stock Detail reuses them instead of keeping a second copy.
- Requests are cancelled via `AbortSignal` when queries are abandoned. Identical in-flight queries are de-duplicated by TanStack Query.
- Every state is explicit: loading skeletons, empty states, `ApiErrorState` (with specific copy for not-configured, rate-limited, offline, …), stale and closed badges.

### Watchlist storage

`WatchlistRepository` is the boundary. V1 uses `LocalStorageWatchlistRepository` (versioned JSON under `mallowtick.watchlist.v1`, sanitized on read, synced across tabs via `storage` events). If storage is blocked, it falls back to an in-memory list. The UI states that the list is stored on this device only. An account-backed repository can replace it without UI changes.

## PWA

- `app/manifest.ts` → `/manifest.webmanifest`: standalone display, `/` start URL, 192/512 icons plus a maskable 512 icon. The Apple touch icon and `appleWebApp` metadata are in the root layout. `viewport-fit=cover`, and safe-area insets pad the header and bottom nav.
- Icons are generated from SVG by `pnpm icons` (`scripts/generate-icons.mjs`, uses sharp) and committed.
- **Service worker** (`public/sw.js`, registered in production builds only):
  - `/api/*` is never intercepted or cached. Market data always comes from the network.
  - `/_next/static/*`, icons, and the mascot: cache-first (content-hashed or static).
  - Page navigations: network-first. Successful pages are cached as an offline shell; the fallback order is cached page, then `/offline`. Pages contain no market data (it is fetched client-side), so a cached shell can't present old prices as live.
  - While offline, TanStack Query keeps the last data in memory, and the freshness badge switches to **Offline** with the data's timestamp.
- HTTPS is required in production for service workers and installability. Terminate TLS at your host or proxy.

## Known limitations

- No streaming: quotes are polled (see [market-data.md](market-data.md#polling-strategy-no-streaming-in-v1)).
- The free Twelve Data plan's daily credits run out quickly with continuous polling. Tune `QUOTE_CACHE_TTL` or upgrade.
- Benchmarks are ETFs (SPY/QQQ/DIA), not index levels.
- No company logos (initials are shown instead), news, financials, technical indicators, or portfolio.
- The watchlist is per device and not synced. It holds at most 25 symbols (the API batch limit).
- Support/resistance has no multi-timeframe confluence, and its parameters aren't runtime-configurable.
- Server caches are in-memory and per process. Multiple API replicas would each spend provider credits; use a shared cache before scaling out.
- Personal market-data plans don't permit public redistribution (see [market-data.md](market-data.md)).
