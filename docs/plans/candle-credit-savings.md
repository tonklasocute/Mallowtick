# Plan: fit a small group of users into the free data plans

Status: A–D done on branch `feat/candle-credit-savings` (2026-11-07). Checked with the real
API: 1M, 3M and 1Y of AAPL cost one `/time_series` credit together. Next: a day of
`LOG_LEVEL=debug` during a session to measure real usage, then the "Later" items.

## Goal

Mallowtick is free and non-commercial, for a small group of people (up to ~100). It should stay
inside the free plans without showing "รอโควตา" in normal use:

- Twelve Data: 8 credits/min (sliding 60 s window), 800/day. Serves candles, market status, USD/THB.
- Finnhub: 60 calls/min. Serves quotes, search, fundamentals, earnings, sectors.

Finnhub has room to spare. **Twelve Data candles are the bottleneck.**

## Where the credits go today

Candles are cached per symbol and range (`internal/market/params.go`). Cost per symbol per
trading day (6.5 h) when someone keeps looking at it:

| Range | Interval | TTL while open | Credits/day/symbol |
|---|---|---|---|
| 1D (also every sparkline) | 5min | 5 min | ~78 |
| 1W | 30min | 15 min | ~26 |
| 1M, 3M, 1Y (three separate daily fetches) | 1day | 1 h | ~7 each |
| 5Y | 1week | 6 h | ~2 |

Thirty watchlist symbols with sparklines alone come to ~2,340 credits/day, three times the cap.

## Changes

### A. One daily series per symbol (API, `internal/market`)

1. 1M, 3M and 1Y read one cached series, key `candles:<SYM>:daily`, fetched once with
   `max(Bars of 1M/3M/1Y) + WarmupBars` = 1,152 daily bars (one credit, like now). `Candles`
   slices the visible bars and the warm-up from it exactly as today, so the response shape does
   not change. 1D, 1W and 5Y keep their own entries.
2. TTL of the daily series: while the market is open, until the close (from the cached market
   status; 1 h when the status is unknown). While closed, until the next open (as now). The first
   request after the close refetches it, which also brings the final bar with the full-session
   volume that `sessionVolume` relies on.
3. Today's bar is refreshed from the quote at read time, never by fetching: when a **fresh quote
   is already cached** for the symbol and its `asOf` is on or after the last daily bar's session
   date (exchange time zone), replace that bar's OHLC (or append a bar for a new session, opening
   at midnight exchange time, like Twelve Data's daily bars). Close = quote price, open/high/low
   from the quote. Volume = the quote's volume, or `null` when the quote has none (Finnhub) – never
   the partial intraday volume. The cached series itself stays the vendor's data.
4. Freshness must name every vendor in the response. When today's bar came from a quote of
   another vendor, `freshness.provider` is `"<bar vendor>+<quote vendor>"` (e.g.
   `twelvedata+finnhub`) and `asOf` is the quote's time. Otherwise unchanged.
5. `sessionVolume` reads the daily entry instead of the three range entries.

Result: about 2 credits per symbol per day for 1M/3M/1Y together, instead of ~21.

### B. Keep the cache across restarts (API, `internal/cache`, `cmd/api`, `internal/config`)

1. `cache.TTL` gains `Snapshot()` and `Restore()` that keep each entry's stored and expiry times.
2. `Service` gains `SaveCache(io.Writer)` / `LoadCache(io.Reader)` (versioned JSON) for the caches
   that cost Twelve Data credits: candles, market status and the exchange rate.
3. `CACHE_FILE` (empty = off) in config and `.env.example`. `cmd/api` loads it before the
   market-status warm-up, saves it every 5 minutes and on shutdown, writing to a temp file and
   renaming. A missing or unreadable file is logged and ignored.

Result: a restart or deploy no longer spends credits refetching what was already fetched.

### C. Watchlist sparklines from daily bars (web)

1. Watchlist rows draw their sparkline from the 1M daily series (same query key as the Stock
   Detail 1M chart, so opening a stock reuses it) instead of 1D intraday. Longer client cache
   (30 min). The colour follows the line's own direction (last close against the first),
   since it is a month, not a day.
2. The Discover hero sparkline stays 1D intraday (one symbol).
3. `vendorLabel` renders combined ids from A.4: `twelvedata+finnhub` → "Twelve Data + Finnhub".

### D. Docs (after A–C are merged)

`docs/market-data.md` (polling strategy, credit budget, freshness), `docs/api.md` if the
freshness provider format is documented there, and the notes in `CLAUDE.md`.

## Expected budget after A–C

| Item | Credits/day |
|---|---|
| Market status | ~2 |
| USD/THB (1 h cache) | ~7–24 |
| Discover hero sparkline (SPY 1D) | ~78 |
| Each symbol viewed (1M/3M/1Y/sparkline) | ~2 |
| Each symbol kept open on 5Y | ~2 |
| Each symbol kept open on 1D / 1W | ~78 / ~26 |

With 50 different symbols viewed in a day: ~200 credits plus whatever intraday charts people
open. Measure with `LOG_LEVEL=debug` (logs every provider call with its credits) for a day.

## Later (not in this branch)

- Per-IP rate limit in the API, so one client cannot spend the budget for everyone.
- Optional fallback vendor for candles when Twelve Data is out of credits.
- Deployment: one API instance (the cache and the credit budget are per process), HTTPS, Docker.

## Work split

A, B and C touch different files and run in parallel, each in its own worktree:

- A: `internal/market/service.go`, `params.go` and their tests.
- B: `internal/cache/*`, a new `internal/market/service_snapshot.go` (+ test),
  `internal/config/*`, `cmd/api/main.go`, `services/api/.env.example`. Does not edit `service.go`.
- C: `apps/web/src/**` only.

Then D, then `make test`, lint and a manual check in the app.
