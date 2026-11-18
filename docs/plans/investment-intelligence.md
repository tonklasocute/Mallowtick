# Investment intelligence upgrade

Plan and design decisions for earnings, news, alerts and the research briefing
(November 2026). What shipped, and what didn't, is summarised at the end.

## Provider facts this design rests on

Checked with real keys on 2026-11-18:

| Call | Result |
|---|---|
| Finnhub `/calendar/earnings?from&to` (no symbol) | Every US company in the range, upcoming **and past** (past rows carry `epsActual`, `revenueActual`). **Capped at 1,500 rows**: 2026-11-04…17 came back as 1,500 rows covering only 11-09…11-17 (the earliest days are cut). |
| Finnhub `/calendar/earnings?symbol=AAPL&from=2024-01-01` | Only the latest report (one row), so revenue actual vs estimate exists for the latest quarter only. |
| Finnhub `/stock/earnings` | Four quarters of EPS actual/estimate. `year`/`quarter` are fiscal (NVDA: year 2027, quarter 3), like the calendar's. |
| Finnhub `/company-news?symbol&from&to` | ~250 articles a week for AAPL (Yahoo 210, Benzinga 25, SeekingAlpha 6, CNBC 5). `url` is a Finnhub redirect (`finnhub.io/api/news?id=…`, 302 to the publisher, no token needed). `related` is only the queried symbol. |
| Finnhub `/news?category=general` / `merger` | 100 / 32 articles, `related` empty. Reuters items link through Google News. |
| Twelve Data daily `/time_series` | Completed sessions carry full-market volume (AAPL 31–50M shares), unlike intraday bars. |

The earlier note that the calendar returns nothing for past dates (2026-10-26) no
longer holds.

## Decisions

- **No server database.** Everything server-side stays a cache. Alerts, read state
  and the portfolio stay on the device. Symbols sent in a query (`symbols=`) are
  used for that request and its caches only.
- **Watchlist and portfolio stay in localStorage.** They are small, synchronous and
  working; moving them to IndexedDB would risk the data for no gain. They get a
  version guard: a value written by a newer build, or one that no longer parses, is
  never overwritten (the raw value is backed up first). Alerts use IndexedDB.
- **Latency is declared per vendor** (`FINNHUB_LATENCY`, `TWELVEDATA_LATENCY`, both
  defaulting to `MARKET_DATA_LATENCY`), so one vendor's entitlement is never shown
  on the other's data.
- **Earnings calendar** is fetched in whole weeks (Monday–Sunday, New York time) and
  cached per week, shared by every request. A week that returns 1,500 rows is split
  in halves until each part is under the cap. Weeks in the past are kept 24h, the
  current week 30 minutes (actuals arrive during the day), later weeks 6h.
- **Company names** in the calendar come only from names the API already knows
  (cached profiles); there is no profile call per row.
- **News** keeps the provider's URL (the Finnhub redirect) and names the publisher
  from `source`. Duplicates are grouped by provider id, normalised URL and
  normalised headline; each publisher of a group stays listed.
- **No web push.** It needs the server to keep subscriptions and evaluate the rules
  in the background, i.e. upload private alert rules and spend provider calls with
  nobody looking. Alerts are evaluated in the app, on data it fetched anyway.
- **Research insights are rule-based**, computed in Go from vendor data. Each names
  its facts, source, time and completeness; none recommends buying or selling, and
  none claims a cause. Portfolio concentration is computed in the browser, since
  holdings never leave the device.
- **Budget:** research and news fetch only a few missing items per request and
  report the rest as unavailable, like the sectors; the client asks again later.

## What shipped

- Phase 0: storage version guard, per-vendor latency, contract tests, circuit breaker and
  `/health` vendor stats, jittered client retries.
- Phase 1: `/earnings` calendar screen, `/earnings/*` endpoints, revenue and beat/miss on
  Stock Detail, upcoming earnings on Portfolio.
- Phase 2: `/news` (for you, market, company), `/news/*` endpoints with grouping, Stock
  Detail news.
- Phase 3: alerts (7 rule types, IndexedDB, notification center, bell, toast).
- Phase 4: `/briefing`, `/compare`, `/research/*` endpoints.

Not built: web push (see Decisions), revenue history beyond the latest quarter (no free
source with estimates), SEC EDGAR statements, translated or summarised news (no LLM), an
automated browser E2E suite (journeys were checked by hand in a real browser).
