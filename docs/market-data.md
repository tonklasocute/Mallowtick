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

## What is (and isn't) used

| Need | Twelve Data endpoint | Credits |
|---|---|---|
| Symbol search | `/symbol_search` (filtered to `country = United States`) | 1/request |
| Latest quote | `/quote` (comma-separated batch) | 1/symbol |
| Candles | `/time_series?order=asc` | 1/request |
| Market status | `/market_state?code=XNYS` | 1/request |

Not used in V1: WebSocket streaming (Basic/Grow plans only allow trial symbols), company logos, fundamentals, news, US index symbols (SPX/IXIC/DJI). The Discover benchmarks default to the ETFs SPY/QQQ/DIA, and the UI shows the provider's instrument name (e.g. "SPDR S&P 500 ETF Trust"), never an index level.

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
  - **Candles** are cached per symbol+range for about one bar while the market is open: 5 min (1D), 15 min (1W), 30 min (1M), 1 h (3M/1Y), 6 h (5Y). When the market is closed they are kept until the next open.
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
