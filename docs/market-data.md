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

- **Server cache bounds provider usage** regardless of how many clients poll. Quotes are cached per symbol for `QUOTE_CACHE_TTL` (60s), or `QUOTE_CACHE_TTL_CLOSED` (15m) when the provider reports the market closed. Candles are cached per symbol+range: 1 min (1D), 5 min (1W/1M), 15 min (3M/1Y), and 1 h (5Y).
- **Concurrent identical requests share one provider call** (singleflight). Batch quotes only fetch the symbols missing from cache.
- **A local credit limiter** (`TWELVEDATA_CREDITS_PER_MINUTE`) spends credits before each request and fails fast with `rate_limited` instead of waiting longer than `TWELVEDATA_MAX_WAIT`. Batches larger than the per-minute allowance are split, and any part that can't run is reported in `unavailable`.
- **Stale fallback:** if a refresh fails (other than "not found"), a value fetched within `STALE_RETENTION` is returned with `stale: true`.
- **Client:** visible screens refetch quotes every `NEXT_PUBLIC_QUOTE_REFRESH_SECONDS` (60s) and when the app regains focus. Hidden tabs don't poll. 1D charts refresh every 2 minutes; longer ranges refresh on focus only. Sparklines are fetched once and kept for 10 minutes.

### Credit budget on the free plan

800 credits/day is about 0.55 credits/minute on average, so continuous polling exhausts it within hours. Rough cost while a screen is open: Discover with 3 benchmarks + 4 popular stocks ≈ 7 credits/min (+1 per sparkline); Stock Detail ≈ 1 credit/min for the quote plus 0.5/min for 1D candles. For daily use on the free plan, raise `QUOTE_CACHE_TTL` (e.g. `5m`) and/or trim `POPULAR_SYMBOLS`. A paid plan removes the daily cap.

## Adding another provider

Implement `market.Provider` (`services/api/internal/market/provider.go`) in a new package under `internal/market/`, map vendor errors onto the `market.Err*` sentinels, and select it in `cmd/api/main.go`. Handlers, caching, freshness, and the UI need no changes.
