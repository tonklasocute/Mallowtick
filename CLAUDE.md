# Mallowtick

US stock analysis app (PWA, iOS add-to-home-screen). Tagline: "Small Charts. Big dreams."

Monorepo: `apps/web` (Next.js, pnpm) and `services/api` (Go/Gin). See README.md and docs/.
Checks: `make test`, `make lint`, `make build`. Never add mock or placeholder market data;
missing credentials must surface as "provider not configured".

## Design reference — read before any UI work

Before creating or changing any UI (screens, components, styles, icons, colors), open
[docs/design-reference.png](docs/design-reference.png) with the Read tool and look at it.
Do not rely on the notes below alone; the image is the source of truth.

Quick notes from the reference (verify against the image):

- Palette: Mint `#A7E3C2`, Sky `#BFE8FF`, Cream `#FFF9F0`, Soft Blue `#E6F4FF`,
  Gray `#6B7280`, Accent `#FFB6C1`
- Mascot: a cream marshmallow with a sprout on top; logo wordmark "Mallowtick" with an up-trend arrow on the "k"
- Screens (V1): Discover (search, S&P 500 / Nasdaq / Dow cards, popular stocks),
  Stock Detail (price header, Overview/Chart/News/Financials tabs, candlestick chart with
  support/resistance lines, key levels, stats, technicals), Watchlist (category chips,
  rows with sparkline, price, % change)
- Bottom tab bar: Discover, Watchlist, Portfolio, More
- Style: soft rounded cards, light cream background, green for up / red for down

## Keep this file current

When you change a convention, add a workaround, or hit a problem that isn't fixed yet, record
it in this file in the same change. Remove the note once the problem is fixed.

## UI language: Thai

All user-facing copy is Thai (`<html lang="th">`, manifest `lang: "th"`), written directly in
the components; there is no i18n library yet. Tests assert the Thai strings.

- Keep in English: the brand name and tagline, tickers, chart range buttons (1D, 1W, …),
  level labels (R1, S1), and price/time formatting (`$189.32`, `3:59 PM ET`, en-US).
- Errors in `apps/web/src/services/api/client.ts` stay English: they are for debugging, and
  the UI maps error codes to Thai copy in `components/market/api-error-state.tsx`.
- API text that the UI shows verbatim must be Thai too, e.g. the levels disclaimer in
  `services/api/internal/market/service.go`.

## Server vs browser rendering

Pages are server-rendered and then hydrated. Values that only the browser knows (storage,
display mode, …) must not appear in the first render: read them with `useSyncExternalStore`
and a server snapshot of `null` (see `useStorageDescription`, `useIsStandalone`).

## Provider credit budget

The Twelve Data free plan allows 8 credits/minute and 800/day, and a batch quote costs one
credit per symbol. Before adding anything that calls the provider, work out its credit cost
and keep it inside the budget in [docs/market-data.md](docs/market-data.md#credit-budget-on-the-free-plan)
(server cache first, fetch only what is on screen).

Twelve Data counts credits in a **sliding 60-second window**, verified with the real API on
2026-10-26. Don't swap `twelvedata/budget.go` for a token bucket or a per-calendar-minute
counter: both let a 9th credit through, and the provider returns 429. To see real usage, run
the API with `LOG_LEVEL=debug`; it logs each provider call with its credits.

## Price chart

- Stock Detail opens on **1M daily candles**. EMA lines (default 20/50/100/200, 2–300
  bars, four colour slots) are computed in the browser (`lib/ema.ts`) from the API's
  `warmup` + `candles`; chart layer toggles and periods are saved per device
  (`features/stock-detail/chart-prefs.ts`).
- The chart card follows a cute pastel mock: pastel candles, prices as pills beside the
  plot instead of a price axis, dashed pink/mint levels. No earnings markers or chip until
  there is a real earnings data source.
- The chart shows **no TradingView logo** (`attributionLogo: false`, the user's decision).
  The licence allows that only because More → About shows the NOTICE text and a link to
  https://www.tradingview.com/. Keep that credit when editing the More screen.
- Colour tokens read only by the canvas or inline styles go in the `@theme static` block of
  `globals.css`. Tailwind v4 drops theme variables that no utility class uses, so they
  would silently fall back otherwise.

## Local development (Windows)

- pnpm is not installed globally; run it through corepack: `corepack pnpm install`,
  `corepack pnpm --filter @mallowtick/web dev` (port 3000).
- API: `go run ./cmd/api` in `services/api` (port 8080). It reads its settings from the
  environment; `go run` alone does not load `services/api/.env` (`make dev-api` does, through
  bash). Without a key it runs with the provider not configured. `go run` does not
  hot-reload; restart after Go changes.
- `services/api/.env` holds the real Twelve Data key. It is gitignored; never commit it or
  print it in logs or output.
- Git Bash `sed -i` converts CRLF files to LF. Edit with the Edit tool or `perl -pi` instead.

## Known issues

- `make lint` fails at `format:check`: the working copy is CRLF (`core.autocrlf=true`) and
  Prettier expects LF, so ~95 files are flagged even when unchanged. To check edited
  files only: `prettier --check --end-of-line auto <files>`.
- `services/api/.env` must use LF line endings. `make dev-api` sources it with bash, so a
  CRLF copy of `.env.example` leaves `\r` on every value and the API key is rejected.
  Convert with `tr -d '\r'` after copying.
- `gofmt -l .` lists every Go file for the same CRLF reason. To check a file:
  `tr -d '\r' < file.go | gofmt -d`.
