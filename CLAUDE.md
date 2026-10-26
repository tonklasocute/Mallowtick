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

## Local development (Windows)

- pnpm is not installed globally; run it through corepack: `corepack pnpm install`,
  `corepack pnpm --filter @mallowtick/web dev` (port 3000).
- API: `go run ./cmd/api` in `services/api` (port 8080). Without `services/api/.env` it runs
  with the provider not configured. `go run` does not hot-reload; restart after Go changes.
- Git Bash `sed -i` converts CRLF files to LF. Edit with the Edit tool or `perl -pi` instead.

## Known issues

- `make lint` fails at `format:check`: the working copy is CRLF (`core.autocrlf=true`) and
  Prettier expects LF, so ~95 files are flagged even when unchanged. To check edited
  files only: `prettier --check --end-of-line auto <files>`.
- Hydration mismatch on `/more`: `createRepository` in `apps/web/src/app/providers.tsx`
  returns `MemoryWatchlistRepository` on the server but `LocalStorageWatchlistRepository` in
  the browser, so the watchlist storage description differs between server and client HTML.
