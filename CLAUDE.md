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
  Gray `#6B7280`, Accent `#FFB6C1`. The colour tokens in `globals.css` now follow the
  `.app` tokens of the Claude design canvas instead (page `#FFF7EC`, ink `#1D3B32`, up
  `#25A874`, down `#EE6A86`, …), asked for on Stock Detail on 2026-10-27 and applied app-wide
  because every canvas artboard shares them. `up`/`down` are the darker text colours;
  `up-fill`/`down-fill` are for bars and dots.
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
2026-10-26. Don't swap `internal/ratebudget` for a token bucket or a per-calendar-minute
counter: both let a 9th credit through, and the provider returns 429. To see real usage, run
the API with `LOG_LEVEL=debug`; it logs each provider call with its credits.

## Market data vendors

- With `FINNHUB_API_KEY` set, **Finnhub** serves quotes, search and the earnings calendar
  (60 calls/min, per-call budget in `internal/ratebudget`), and **Twelve Data** keeps
  candles and market status (`market.Composite`, wired in `cmd/api/main.go`). Without it,
  Twelve Data serves everything.
- Tested with real keys on 2026-10-26. Finnhub's free plan has **no candles** (403) and
  **no past earnings dates** (empty list), and its quotes have no volume, name or market
  state. Don't plan features on those.
- Company fundamentals: Stock Detail shows the Finnhub profile, key ratios and returns vs
  the S&P 500 (`/fundamentals`), EPS against estimates (`/earnings/history`) and analyst
  ratings (`/recommendations`), in `features/stock-detail/`. News and SEC statements were
  tested on 2026-10-27 but are not used yet. What each free source gives, and what is 403, is in
  [docs/market-data.md](docs/market-data.md#company-fundamentals). The industry name is the
  vendor's English text; there is no Thai mapping yet.
- Company logos: Finnhub's `profile2` `logo` URL travels as `logo` on quotes and search
  results (`""` for ETFs, symbols without one, and Twelve Data alone). The browser never
  loads Finnhub directly: `SymbolAvatar` uses `next/image`, so the server shrinks the
  1000×1000 originals and caches them for a day. `images.remotePatterns` in
  `next.config.ts` allows only `*.finnhub.io/file/publicdatany/finnhubimage/stock_logo/**`
  (the redirect to another `static*` host is followed without matching again). Initials
  stay underneath and take over when there is no logo, it fails, or the PWA is offline.
- Freshness and `/health` name the vendor per kind of data (`Service.source(kind)`). Keep
  that when adding a data kind; never label one vendor's data with another's name.
- Never sum Twelve Data free-plan intraday volumes. They cover only part of the market
  (about 50k shares in AAPL's first 5-minute bar), so totals are far too low. Session
  volume comes from the final daily bar after the close, or stays unknown.

## Price chart

- Stock Detail opens on **1M daily candles**. EMA lines (default 20/50/100/200, 2–300
  bars, four colour slots) are computed in the browser (`lib/ema.ts`) from the API's
  `warmup` + `candles`; chart layer toggles and periods are saved per device
  (`features/stock-detail/chart-prefs.ts`).
- The chart card follows the "กราฟราคา (Chart card)" artboard of the Claude design canvas:
  pastel candles, a dashed grid at round prices labelled in the pill column instead of a
  price axis, level pills ("R1 56.13" on phones, "แนวต้าน 1 56.13" from `sm`), a pulsing
  last-price dot and a dark hover tooltip with the bar's OHLC and volume. Above 140 bars
  (1Y, 5Y) it draws a close line with a soft fill instead of candles. The grid is an SVG
  overlay; SVG attributes can't read CSS variables, so colour it with classes. There are no earnings markers on
  the chart, since no vendor here provides past report dates. The next report is shown as a
  badge under the price instead (`features/stock-detail/earnings-badge.tsx`, from Finnhub).
- The chart shows **no TradingView logo** (`attributionLogo: false`, the user's decision).
  The licence allows that only because More → About shows the NOTICE text and a link to
  https://www.tradingview.com/. Keep that credit when editing the More screen.
- Colour tokens read only by the canvas or inline styles go in the `@theme static` block of
  `globals.css`. Tailwind v4 drops theme variables that no utility class uses, so they
  would silently fall back otherwise.

## Stock Detail screen

- Follows the "RKLB 1–3" artboards of the Claude design canvas (one page in three
  screens): 26px cards (`rounded-panel`) with pastel icon tiles, soft tiles for numbers,
  level boxes with a five-step strength meter, range bars for the day and 52 weeks,
  returns and margins as bars from a centre line, an EPS dot chart and a stacked analyst
  bar. Shared pieces are in `features/stock-detail/detail-ui.tsx`. Every number comes
  from the API; the canvas values are examples.
- The canvas stops at profitability in "ตัวเลขสำคัญ"; financial health and dividends use
  the same tiles. Its "฿" glyph for "มูลค่าบริษัท" is "$" here, since prices are in USD.
- The header repeats the price ("RKLB $53.82") once the price line scrolls under it.
- The chart toggles wrap onto a second row on phones (the canvas CSS wraps them too).

## Discover screen

- Follows the "หน้าแรก (Home)" artboard of the Claude design canvas: mint hero with the
  mascot on the right, pill search with a dark submit button, pastel ticker chips, prices
  with a raised `$` (`components/market/price-text.tsx`), and a floating pill bottom nav
  (shared by every screen; `--nav-height`/`--nav-offset` in `globals.css`).
- Only the first benchmark card draws a sparkline (with a dashed previous-close line). The
  design also shows them on the other benchmarks and popular rows; they were left out on
  purpose because each costs a provider credit (user's decision, 2026-10-26).
- The hero mascot floats slowly (`animate-bob`, 4 s). It stays still under
  `prefers-reduced-motion`, which Windows turns on when "Animation effects" is off.
- Fonts follow the design canvas: Nunito for Latin text and numbers, Mitr for Thai, loaded
  with `next/font` in `app/layout.tsx` (self-hosted, so offline works). Nunito has no Thai
  glyphs, so Thai falls back to Mitr in the same font stack. Mitr looks heavy: the canvas
  uses 300–500 for Thai, so prefer `font-light`/`font-normal`/`font-medium` on Thai copy.
- The mascot (`components/brand/mascot.tsx`) is drawn as on the canvas: a white body with a
  dark outline, not the cream body of docs/design-reference.png (user's decision,
  2026-10-27). The favicon and app icons in `public/icons` still show the old mascot.
- The design's bell button and "ดูทั้งหมด" link are omitted: there are no notifications or
  full popular list yet.

## Local development

The project is worked on from both a Windows PC and a Mac.

- Ports: web 3000, API 8080. `make dev-api` loads `services/api/.env` (through bash);
  `go run ./cmd/api` alone does not, and without a key the API runs with the provider not
  configured. The API does not hot-reload; restart it after Go changes.
- `services/api/.env` is gitignored and per machine, so each machine needs its own copy with
  the Twelve Data and Finnhub keys. Never commit it or print it in logs or output. With
  Finnhub quotes it uses `QUOTE_CACHE_TTL=60s`. Without `FINNHUB_API_KEY`, Twelve Data serves
  everything and its 8 credits/min run out quickly. `GET /api/v1/health` shows which vendor
  serves each kind of data.

### macOS

- pnpm is installed through Homebrew: `make dev-api`, `make dev-web`, `make test`,
  `make lint`, `make build` work as is.
- The working copy is LF (`core.autocrlf` unset), so `make lint` (including
  `format:check`) and `gofmt -l .` are clean. The CRLF issues below do not apply.

### Windows

- pnpm is not installed globally; run it through corepack: `corepack pnpm install`,
  `corepack pnpm --filter @mallowtick/web dev`.
- API: `go run ./cmd/api` in `services/api`, with the settings in the environment (see above).
- Git Bash `sed -i` converts CRLF files to LF. Edit with the Edit tool or `perl -pi` instead.

## Known issues

- Windows only: `make lint` fails at `format:check`: the working copy is CRLF
  (`core.autocrlf=true`) and Prettier expects LF, so ~95 files are flagged even when
  unchanged. To check edited files only: `prettier --check --end-of-line auto <files>`.
- Windows only: `services/api/.env` must use LF line endings. `make dev-api` sources it with
  bash, so a CRLF copy of `.env.example` leaves `\r` on every value and the API key is
  rejected. Convert with `tr -d '\r'` after copying.
- Windows only: `gofmt -l .` lists every Go file for the same CRLF reason. To check a file:
  `tr -d '\r' < file.go | gofmt -d`.
- Unverified: whether Twelve Data's daily bar for today holds the full-market volume right
  after the close. During the session it holds the same partial volume as the intraday
  bars, and closed-market candles are cached until the next open. If Stock Detail shows a
  very low "ปริมาณซื้อขาย" in the evening, that is why. Check once after a close.
- ETF names from Finnhub search are upper case with a vendor prefix (e.g. "SS SPDR S&P
  500 ETF TRUST"), because Finnhub has no profile for ETFs.
