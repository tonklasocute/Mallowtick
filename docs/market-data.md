# Market data

## Provider choice: Twelve Data

Evaluated October 2026 against the published pricing pages (twelvedata.com/pricing, massive.com/pricing). Plans change; re-check before relying on these figures.

| | Twelve Data | Massive (formerly Polygon.io) |
|---|---|---|
| US equity coverage | US stocks and ETFs | All US stock tickers |
| Free plan | Basic: 8 credits/min, 800/day, advertised as "real-time US equities and ETFs" | Basic: 5 calls/min, **end-of-day only**, 2 years history |
| Entry paid plan | Grow ($79/mo listed): real-time US stocks, no daily limit | Starter ($29/mo): **15-minute delayed**, unlimited calls, WebSockets |
| Real-time | Advertised on all plans (Basic included) | Advanced ($199/mo) and up |
| Historical OHLC | `/time_series`, 1min–1month intervals, up to 5000 bars/request | Aggregates, 2–20+ years depending on plan |
| WebSocket | Basic/Grow: "8 trial" symbols only; Pro: 1,500 symbols | Starter and up (delayed below Advanced) |
| Licence | Personal plans are labelled "internal display" / "internal non-display"; commercial use is priced separately | Stocks plans labelled "Individual use"; business use priced separately |

**Why Twelve Data:** it is the only option whose free tier provides intraday, non-EOD quotes and intraday candles, which V1 needs for the 1D chart and meaningful intraday levels. Massive's free tier is end-of-day only, and its cheapest paid tier is 15-minute delayed.

**Licensing caveat:** neither provider's personal plans grant redistribution or public display rights. Running Mallowtick for yourself is in scope; serving it publicly to other people needs a commercial licence from the provider. This is a business decision outside the code.

## Optional second vendor: Finnhub for quotes

With `FINNHUB_API_KEY` set, the API combines two vendors (`market.Composite`):

| Data | Vendor | Why |
|---|---|---|
| Quotes, symbol search, earnings calendar | **Finnhub** | Free plan allows 60 calls/min (vs Twelve Data's 8 credits/min charged per symbol), so quotes can refresh every minute. It also has an earnings calendar. |
| Candles, market status | **Twelve Data** | Finnhub's free plan has no historical candles (checked 2026-10-26: `/stock/candle` answers 403 for daily and 5-minute bars). Its market status also has no countdown to the next open or close. |

Without the key, Twelve Data serves everything as before. Freshness metadata and `/health` (`provider.sources`) name the vendor behind each kind of data.

What the Finnhub free plan gives, as checked with a real key on 2026-10-26:

- **`/quote`:** price, change, open/high/low, previous close and time, one symbol per call, ETFs and `BRK.B` included. No volume, no name, no market state. Unknown symbols return all zeros and are treated as not found.
- **`/stock/profile2`:** name, exchange and currency for stocks, cached for 24h. It is empty for ETFs, so their name comes from an exact `/search` match with the "-US" suffix dropped (e.g. "SS SPDR S&P 500 ETF TRUST").
- **`/stock/metric`:** the 52-week range, cached for 24h and fetched only for single-symbol quotes (Stock Detail).
- **`/calendar/earnings`:** upcoming reports only. A past date range returns an empty list, so past earnings markers on the chart are not possible on this plan.

The service fills in what Finnhub quotes lack:

- **Market state:** taken from the cached Twelve Data market status, so labels and closed-market cache lifetimes still work.
- **Volume:** taken from the session's daily bar only after the close, once that bar is final. During the session it stays unknown (shown as "—"). Twelve Data's free-plan intraday volumes cover only part of the market (AAPL's first 5-minute bar showed about 50k shares), so summing them would be badly wrong. The same partial volumes appear in the 1D/1W chart's volume bars, which are useful for shape only.

## Company fundamentals

Checked with real keys on 2026-10-27 (AAPL, RKLB, SPY) while planning a "know the company" section for Stock Detail. In use on Stock Detail, all from Finnhub:

- The profile and a subset of `/stock/metric`, including price returns against the S&P 500 (`GET /stocks/{symbol}/fundamentals`; the "เกี่ยวกับบริษัท" and "ตัวเลขสำคัญ" cards). One call per symbol every 6h (the profile is already cached for the name); the same call refreshes the 52-week range.
- `/stock/earnings` (`GET /stocks/{symbol}/earnings/history`; "ผลประกอบการล่าสุด") and `/stock/recommendation` (`GET /stocks/{symbol}/recommendations`; "มุมมองนักวิเคราะห์"): one call each per symbol every 12h.

- Company logos: the `logo` URL of the same profile (`static2.finnhub.io/.../stock_logo/<ticker or id>.png`, a 1000×1000 PNG of 50–100 KB that answers 302 to another `static*` host and is cached upstream for 3 hours; checked 2026-10-27). Quotes carry it for free. Search results get logos with up to one extra `/stock/profile2` call per new symbol (cached 24h, 2-second limit), so a first search can cost up to 10 Finnhub calls. The browser loads them through `next/image` (see CLAUDE.md), never from Finnhub directly. Finnhub's terms for displaying logos have not been checked; like the market data itself, serving the app publicly may need a commercial licence.

Opening a new stock therefore costs about 3 Finnhub calls on top of the quote, well inside 60/minute. The rest of the table is not used yet.

| Data | Source | Free plan |
|---|---|---|
| Industry, IPO date, market cap (USD millions), shares outstanding, logo, website | Finnhub `/stock/profile2` (already called for the name) | ✅ Stocks only; `{}` for ETFs. Some small caps have an empty `logo` (BZRT, RCTY). |
| ~130 ratios: P/E, P/S, P/B, EV, margins, ROE/ROA, revenue and EPS growth (YoY, 3Y, 5Y), current ratio, debt/equity, beta, dividend yield, payout, returns vs S&P 500 | Finnhub `/stock/metric?metric=all` (already called for the 52-week range) | ✅ Plus `series.annual`/`series.quarterly` history of ratios and per-share values (no absolute revenue or income). Loss makers have `peTTM: null` and a negative `epsTTM`. ETFs get only price returns, 52-week range and beta. |
| EPS actual vs estimate | Finnhub `/stock/earnings` | ✅ Last 4 quarters only (`limit=12` still returns 4) |
| Analyst buy/hold/sell counts per month | Finnhub `/stock/recommendation` | ✅ |
| Peer tickers | Finnhub `/stock/peers` | ✅ Coarse (RKLB's peers include GE and AXON) |
| Company news | Finnhub `/company-news` | ✅ English; RKLB had 166 articles in two weeks, mostly Yahoo and Benzinga, with headline, summary and image |
| Insider transactions and monthly sentiment | Finnhub `/stock/insider-transactions`, `/stock/insider-sentiment` | ✅ From SEC Form 4 |
| Statements as filed | Finnhub `/stock/financials-reported` | ⚠️ 10-Q values are year-to-date (RKLB Q2 EPS -0.15 = Q1 -0.07 + Q2 -0.08), and some years are missing (no 2023 for RKLB) |
| Quarterly and annual statements | SEC EDGAR `data.sec.gov/api/xbrl/companyfacts/CIK##########.json` | ✅ No key. See below. |
| Business description | Finnhub `/stock/profile` | ❌ 403 |
| Standardised statements, price targets, EPS/revenue estimates, dividend history (`dividend`, `dividend2`), institutional ownership, revenue by segment, executives, ETF profile and holdings | Finnhub | ❌ 403 |
| `/profile`, `/earnings` (Grow+), `/statistics`, `/income_statement` (Pro+) | Twelve Data | ❌ 403; the refusals cost no credits |

**SEC EDGAR** (`companyfacts`, `submissions`, ticker → CIK map in `www.sec.gov/files/company_tickers.json`):

- Requests without a `User-Agent` that names a contact email get 403. SEC allows 10 requests/second.
- Facts with a `frame` are already single periods: `CY2026Q2` is that quarter alone (RKLB revenue $234M), `CY2025` the year, `CY2026Q2I` a balance-sheet instant. Q4 often has no frame and must be derived as the year minus Q1–Q3. Cash-flow facts are year-to-date too, so most quarters have no frame.
- Tags differ by company and change over time: AAPL stopped using `Revenues` in 2018 and reports `RevenueFromContractWithCustomerExcludingAssessedTax`. Pick the tag with the latest data.
- `submissions` has the SIC description (e.g. "Guided Missiles & Space Vehicles & Parts") but an empty `description`.

**Business description** has no free source that covers every company:

- Wikipedia has no Thai page for Rocket Lab, and the English page title is not the company name.
- Looking pages up by CIK through Wikidata (`P5531`) works for AAPL (English and Thai pages) but RKLB's CIK maps to an item with no Wikipedia page.
- Left to decide: summarise the 10-K business section into Thai (untested), or show the industry and website only.

## What is (and isn't) used

| Need | Twelve Data endpoint | Credits |
|---|---|---|
| Symbol search | `/symbol_search` (filtered to `country = United States`) | 1/request |
| Latest quote | `/quote` (comma-separated batch) | 1/symbol |
| Candles | `/time_series?order=asc` | 1/request |
| Market status | `/market_state?code=XNYS` | 1/request |

Not used in V1: WebSocket streaming (Basic/Grow plans only allow trial symbols), news, US index symbols (SPX/IXIC/DJI). The Discover benchmarks default to the ETFs SPY/QQQ/DIA, and the UI shows the provider's instrument name (e.g. "SPDR S&P 500 ETF Trust"), never an index level.

The API key is sent in the `Authorization: apikey …` header, never in URLs or logs, and never reaches the browser.

## Freshness model

Every quote, candle series, levels result, and status response carries `freshness`:

| Field | Meaning |
|---|---|
| `provider` | Adapter name (`twelvedata`). |
| `latency` | **Declared by the operator** via `MARKET_DATA_LATENCY` (`realtime` / `delayed` / `eod` / `unknown`). Never inferred from a response. Defaults to `unknown`. |
| `asOf` | Provider timestamp. Quotes: Twelve Data `last_quote_at`. Candles/levels: open time of the last bar. `null` when the provider didn't report one; it is never replaced with the fetch time. |
| `fetchedAt` | When the API server received the data from the provider (UTC). |
| `stale` | `true` when the provider request failed and an older cached value is being served. |

The client labels data from these fields (`src/lib/freshness.ts`):

1. Offline → **Offline** (stale), with the data's timestamp.
2. `stale: true` → **Stale**, "provider unavailable".
3. Not refreshed by the client for 3× the refresh interval → **Stale**.
4. Quote reports `isMarketOpen: false` → **Market closed**, with the last update time.
5. Otherwise the declared latency: **Real-time** / **Delayed** / **End of day** / **Latency not declared**.

"Real-time" therefore appears only when the operator declares a real-time plan, and only while data is being refreshed.

## Polling strategy (no streaming in V1)

Streaming is not implemented because the Basic and Grow plans only stream a handful of trial symbols. Instead:

- **Server cache bounds provider usage** regardless of how many clients poll.
  - **Market status** is kept until the provider-reported next open or close (at most 6 h), so it costs about two credits a day. Countdowns are recomputed from the cached value's age. The API fetches it once at startup so the first Discover load fits the per-minute budget.
  - **Quotes** are cached per symbol for `QUOTE_CACHE_TTL` while the market is open. Closed-market quotes are kept until the next open; `QUOTE_CACHE_TTL_CLOSED` (15m) applies only while the market status is unknown.
  - **Candles** are cached per symbol+range for about one bar while the market is open: 5 min (1D), 15 min (1W), 1 h (1M/3M/1Y), 6 h (5Y). When the market is closed they are kept until the next open. Each fetch includes 900 warm-up bars for the chart's EMA lines; Twelve Data charges one credit per `/time_series` request regardless of `outputsize` (checked with `/api_usage` on 2026-10-26: 1,200 daily bars cost 1 credit).
  - **Search** results are cached for 24 h.
- **Concurrent identical requests share one provider call** (singleflight). Batch quotes only fetch the symbols missing from cache.
- **A local credit budget** (`TWELVEDATA_CREDITS_PER_MINUTE`, `internal/market/twelvedata/budget.go`) books credits before each request the way Twelve Data counts them: at most N credits in any **sliding 60-second window**, not per calendar minute and not as a refilling token bucket. Both of those let a 9th credit through and the provider answered 429 (observed: 1 credit at :43, 7 at :54, 1 at :01 of the next minute). A request waits up to `TWELVEDATA_MAX_WAIT` (10s) for room and then fails with `rate_limited` without calling the provider. If the provider still answers 429 (e.g. another app uses the same key), the window is marked full.
- **Batch quotes take what fits:** a batch is fetched in the order given, only as far as credits allow. The rest come back in `unavailable` with reason `rate_limited`, and the next poll fills them in. Discover lists benchmarks first, so they win.
- **Stale fallback:** if a refresh fails (other than "not found"), a value fetched within `STALE_RETENTION` is returned with `stale: true`.
- **Client:** visible screens refetch quotes every `NEXT_PUBLIC_QUOTE_REFRESH_SECONDS` (60s) and when the app regains focus; these hit the server cache, not the provider. Hidden tabs don't poll. 1D charts refresh every 2 minutes; longer ranges refresh on focus only. Sparklines are fetched once a row is on screen and kept for 10 minutes; watchlist rows hidden on narrow phones never fetch one.

### Credit budget on the free plan

The free plan allows 8 credits/minute and 800/day, and a batch quote costs one credit per symbol.

- **First Discover load:** 7 credits for 3 benchmarks + 4 popular stocks, plus 1 for the hero sparkline. With the startup status credit in the same 60 s, the sparkline waits for the window and the client retries it after `Retry-After`.
- **Discover left open all session** with `QUOTE_CACHE_TTL=5m` (the `.env.example` value): about 8 credits every 5 minutes, ≈ 620 over a 6.5 h session. With 60s it would be about 3,000, far over the daily cap.
- **Market closed:** cached quotes and candles cost nothing until the next open.
- **Stock Detail:** 1 credit per range first viewed (levels reuse the chart's candles). The quote is usually already cached from Discover.
- **Watchlist:** 1 credit per symbol not yet cached, plus 1 per sparkline that scrolls into view.

To stretch the budget further, raise `QUOTE_CACHE_TTL` or trim `POPULAR_SYMBOLS`. A paid plan removes the daily cap.

## Adding another provider

Implement `market.Provider` (`services/api/internal/market/provider.go`) in a new package under `internal/market/`, map vendor errors onto the `market.Err*` sentinels, and select it in `cmd/api/main.go`. Handlers, caching, freshness, and the UI need no changes.
