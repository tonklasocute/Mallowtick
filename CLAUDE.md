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
- Finnhub `/search` answers 429 to a burst of calls (6 at once) well inside 60/min, and a 429
  marks the whole budget spent for a minute. Keep searches one at a time (`searchSlot` in
  `finnhub/client.go`).
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
- Search never waits for logos: it attaches the cached ones, and `fillLogos` looks up the
  first 5 results' missing ones in the background, only while at least 10 Finnhub calls
  are free (`logoHeadroom`). `Service.Search` fills empty logos from `market.LogoSource`
  when it answers, so the 24h search cache does not keep results logo-less. Don't move
  the profile calls back onto the request path: they made a cold search 1.26 s and filled
  the shared budget.
- Freshness and `/health` name the vendor per kind of data (`Service.source(kind)`). Keep
  that when adding a data kind; never label one vendor's data with another's name. A response
  that mixes vendors names both, joined by `+` (`twelvedata+finnhub`); `vendorLabel` shows
  "Twelve Data + Finnhub".
- Each Finnhub call takes ~300–400 ms from Thailand (measured 2026-11), and Stock Detail asks
  for `/quote` and `/fundamentals` at once. So the quote, its profile and the 52-week range
  are fetched together, and concurrent profile and `/stock/metric` calls for one symbol
  share one request (`share` in `finnhub/client.go`, detached like `Service.do`). Read
  `/stock/metric` through `startMetrics`, not `c.get`. A quote books its call before its
  profile starts, so the name never takes the room the price needs.
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
- 1M, 3M and 1Y are cut from **one daily series per symbol** (`candles:<SYM>:daily`, 1,152
  bars), kept until the close while the market is open. The session's bar is rebuilt from the
  cached quote at read time (`withQuoteBar`, never fetches), so its volume is `null` during the
  session with Finnhub quotes. Don't give daily ranges their own fetches again: that was ~21
  credits per symbol a day, now ~2.
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
- "กลุ่มอุตสาหกรรมเทียบตลาด" (`sector-rotation.tsx`, `/market/sectors`) ranks the 11 S&P 500
  sectors by their SPDR ETFs' returns against SPY. It follows the canvas's Home card: a dark
  "กลุ่มที่นำตลาด" card, then a 4-column mosaic heatmap coloured by the gap to SPY (`heat-0…5`
  tokens). The canvas lays out 10 sectors (2×2, 2 wide, six 1×1, two 2 wide); `tileSizes`
  widens as many of the last tiles as it takes to fill the bottom row, so the API's 11 leave
  no hole. 1×1 tiles use short names (`SHORT_NAMES`, measured in Mitr) and 8px sides instead
  of 10px. It shows price returns, never "fund flows": no free source
  has those. Periods are 1D/1W/3M/YTD/1Y because Finnhub has no one-month return. Finnhub only
  (`provider_not_configured` otherwise), since on Twelve Data it would cost 12 credits a poll.
  It fetches quotes and returns without names (`market.PerformanceProvider`), in caches of
  its own: with the ETF name lookups the first load after an API restart needed ~62 Finnhub
  calls and went over 60/min; without them it is ~40. If the limit still leaves a sector out,
  it shows "รอโควตา กำลังโหลดใหม่" while `useSectors` retries every 15 s. Don't raise
  `FINNHUB_MAX_WAIT` to hide it (a 60 s wait would hold requests open).
- The heatmap refreshes every 5 minutes: the API keeps the day changes that long
  (`sectorQuoteTTL`, until the next open when closed) and `useSectors` polls as often
  (`SECTORS_REFRESH_MS`). Every minute it took 12 of Finnhub's 60 calls/min and left
  searches and Stock Detail short. Its "อัปเดต" time is the data's own fetch time, so it can
  read up to ~10 minutes old; it has no freshness badge that would call that stale.

## Watchlist screen

- Row sparklines show one month of daily closes (`useDailySparkline`, `range=1m` without
  warm-up), not today's intraday line: the API serves 1M from its daily series, about two
  credits per symbol a day, where 1D cost ~78. Their colour follows the line over the month,
  so a green line can sit next to a red day change. The Discover hero sparkline stays 1D.

## Portfolio screen

- `/portfolio` ("พอร์ต", the 4th tab) follows the "Mallowtick พอร์ตของฉัน" design canvas
  (https://claude.ai/artifact/H5yaUmZuZ4y8X4a8wM5Xef): a dark summary card with the value
  goal, a folded allocation donut, holdings with an "ติดลบ" filter, a holding sheet and a
  goals sheet for the value goal. Code in `features/portfolio/`; the canvas values are examples.
- Holdings are typed in by the user and stored on the device only
  (`mallowtick.portfolio.v1`, same repository pattern as the watchlist). Up to 25, the batch
  quote limit.
- Baht values use `/fx/usd-thb` (Twelve Data, cached 1h). The cost uses the purchase rate
  when given, so the gain splits into the share price's part and the baht's. Without a rate
  the screen falls back to dollars and says so; it never assumes one.
- The holding sheet asks only for shares and the average cost or the total cost in USD
  (either one fills in the other; the user's decision, 2026-10-27). The model still has a
  purchase baht rate, target price, stop loss and target weight: editing keeps saved values,
  but no screen sets them. The goals sheet's target weights were removed too (user's
  decision, 2026-10-27: not useful).
- With four tabs the bottom nav stacks the icon over the label for the unselected ones.

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
- `CACHE_FILE=./.cache/market-cache.json` (in `.env.example`; add it to an existing `.env` by
  hand) keeps candles, market status and USD/THB across API restarts, so restarting after a
  Go change doesn't spend those credits again. The file is gitignored (`services/api/.cache/`)
  and is skipped when `TWELVEDATA_API_KEY` is unset. Delete it to force fresh fetches. Bump
  `cacheSnapshotVersion` (`internal/market/service_snapshot.go`) when a saved cache's keys or
  value type change.

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
- `go test -race` needs cgo and there is no gcc; golangci-lint isn't installed. Both run on an
  LF export of a commit (plain `git archive` applies `core.autocrlf` and gives CRLF again):
  - `git -c core.autocrlf=false archive HEAD services/api | tar -x -C <dir>`
  - race tests in Docker: `MSYS_NO_PATHCONV=1 docker run --rm -v "<dir>/services/api:/src"
    -w /src golang:1.27 go test -race ./...`
  - lint: `GOTOOLCHAIN=go1.27.2 GOBIN=<bin> go install
    github.com/golangci/golangci-lint/v2/cmd/golangci-lint@latest`, then
    `GOTOOLCHAIN=go1.27.2 <bin>/golangci-lint run ./...` in `<dir>/services/api`. A
    golangci-lint or staticcheck built with an older Go can't load this module (go 1.27).

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
  bars (the chart shows `null` instead, see Price chart). The daily series is refetched on
  the first request after the close and then kept until the next open, so if Stock Detail
  shows a very low "ปริมาณซื้อขาย" in the evening, that bar was still partial. Check once
  after a close.
- Unverified with the real API: the session's daily bar rebuilt from the Finnhub quote while
  the market is open (unit tests only; added on a Saturday). Check during a session with
  `LOG_LEVEL=debug`: 1M/3M/1Y should show today's price, `volume: null` on the last bar,
  `freshness.provider` `twelvedata+finnhub`, and no `/time_series` call until the close.
- ETF names from Finnhub search are upper case with a vendor prefix (e.g. "SS SPDR S&P
  500 ETF TRUST"), because Finnhub has no profile for ETFs.
