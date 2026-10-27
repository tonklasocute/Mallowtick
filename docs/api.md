# Mallowtick API (v1)

Base path: `/api/v1`. All endpoints are `GET` and return JSON with `Cache-Control: no-store`. The web app calls them through its same-origin proxy (`apps/web/src/app/api/v1/[...path]/route.ts`).

## Envelope

Success:

```json
{ "data": { … } }
```

Error:

```json
{ "error": { "code": "rate_limited", "message": "…", "requestId": "e5e8735a7c840b5e" } }
```

`X-Request-ID` is echoed (a valid incoming one is reused) and appears in logs. Error messages are safe to show to users. Provider details are only logged.

| Code | HTTP | When |
|---|---|---|
| `invalid_request` | 400 | Bad symbol, query, range or list |
| `not_found` | 404 | Unknown symbol / no data, or unknown endpoint |
| `rate_limited` | 429 | Local credit limiter or provider limit (`Retry-After: 60`) |
| `provider_not_configured` | 503 | `TWELVEDATA_API_KEY` not set |
| `provider_auth_failed` | 502 | Provider rejected the key |
| `provider_not_entitled` | 502 | Plan doesn't include the data |
| `provider_unavailable` | 502 | Provider error or unreachable |
| `timeout` | 504 | Request exceeded its deadline |
| `internal_error` | 500 | Unexpected error |
| `method_not_allowed` | 405 | Non-GET method |

The web proxy adds `api_unreachable` (502) when the Go API can't be reached.

## Validation

- **symbol**: case-insensitive US ticker, `^[A-Z][A-Z0-9]{0,6}([.-][A-Z0-9]{1,3})?$` (e.g. `AAPL`, `BRK.B`).
- **q**: 1–40 characters of letters, digits, spaces, and `.,&'-`.
- **symbols**: comma-separated, de-duplicated, at most 25.
- **range**: `1d` | `1w` | `1m` | `3m` | `1y` | `5y`.

| Range | Interval | Bars |
|---|---|---|
| `1d` | 5min | 78 (one session) |
| `1w` | 30min | 65 |
| `1m` | 1day | 22 |
| `3m` | 1day | 63 |
| `1y` | 1day | 252 |
| `5y` | 1week | 260 |

Each range is fetched with up to 900 earlier warm-up bars in the same provider request (one credit), so indicators such as a 300-bar EMA have converged by the first visible bar.

`freshness` objects are described in [market-data.md](market-data.md#freshness-model). Timestamps are RFC 3339. Candle times carry the exchange offset.

## Endpoints

### `GET /health`

Liveness and provider configuration. Always 200 while the server runs.

```json
{ "data": { "status": "ok", "time": "…", "provider": { "name": "finnhub+twelvedata", "configured": true, "latency": "unknown",
  "sources": { "quotes": { "name": "finnhub", "configured": true }, "search": { "name": "finnhub", "configured": true },
    "candles": { "name": "twelvedata", "configured": true }, "status": { "name": "twelvedata", "configured": true },
    "earnings": { "name": "finnhub", "configured": true }, "fundamentals": { "name": "finnhub", "configured": true } } } } }
```

`sources` names the vendor behind each kind of data. With Twelve Data alone every entry is `twelvedata`, and `earnings` and `fundamentals` are absent.

### `GET /market/status`

NYSE open/closed state from the provider.

```json
{ "data": { "exchange": "XNYS", "name": "NYSE", "isOpen": false, "opensInSeconds": 16044, "closesInSeconds": null, "freshness": { … } } }
```

### `GET /market/overview`

Quotes for `MARKET_OVERVIEW_SYMBOLS` (`benchmarks`) and `POPULAR_SYMBOLS` (`popular`), fetched in one de-duplicated batch, in configured order. Lists are empty when not configured. Each `unavailable` entry has a `group` (`benchmark` or `popular`), so clients can show it in place.

```json
{ "data": { "benchmarks": [Quote…], "popular": [Quote…], "unavailable": [{ "symbol": "DIA", "reason": "rate_limited", "group": "benchmark" }] } }
```

### `GET /stocks/search?q=apple`

US instruments matching a ticker or company name (up to 10).

```json
{ "data": { "query": "apple", "results": [{ "symbol": "AAPL", "name": "Apple Inc.", "exchange": "NASDAQ", "micCode": "XNGS", "currency": "USD", "type": "Common Stock", "country": "United States" }] } }
```

### `GET /stocks/quotes?symbols=AAPL,MSFT`

Batch quotes in request order. Missing symbols are listed in `unavailable` with a reason code. The request fails as a whole only when nothing could be resolved because of a provider-level error.

### `GET /stocks/{symbol}`

Instrument metadata (same shape as a search result). Cached for 24h.

### `GET /stocks/{symbol}/quote`

```json
{
  "data": {
    "symbol": "AAPL", "name": "Apple Inc.", "exchange": "NASDAQ", "currency": "USD",
    "price": 347.73, "open": 349.12, "high": 351.73, "low": 345.75, "previousClose": 348.22,
    "change": -0.49, "changePercent": -0.1407, "volume": 39496500,
    "fiftyTwoWeek": { "low": 243.42, "high": 351.73 }, "isMarketOpen": false,
    "asOf": "2026-10-23T19:59:00Z",
    "freshness": { "provider": "twelvedata", "latency": "unknown", "asOf": "2026-10-23T19:59:00Z", "fetchedAt": "2026-10-26T09:16:51Z", "stale": false }
  }
}
```

Fields the provider didn't report are `null`. With Finnhub quotes, `exchange` is empty for ETFs, `volume` is filled in only after the close (from the session's daily bar), and `fiftyTwoWeek` is looked up for this single-symbol endpoint only (batch quotes leave it `null`).

### `GET /stocks/{symbol}/earnings`

The next scheduled earnings report, from a vendor with an earnings calendar (Finnhub). `next` is `null` when nothing is scheduled in the next 90 days. Fails with `provider_not_configured` when no configured vendor publishes a calendar. Cached for 12h.

```json
{ "data": { "symbol": "AAPL", "next": { "symbol": "AAPL", "date": "2026-11-02", "hour": "amc", "quarter": 4, "year": 2026,
  "epsEstimate": 2.0221, "revenueEstimate": 115496910249 }, "freshness": { "provider": "finnhub", … } } }
```

`hour` is `bmo` (before the open), `amc` (after the close), `dmh` (during the session), or empty.

### `GET /stocks/{symbol}/fundamentals`

Company profile and key ratios from a vendor that publishes them (Finnhub: `/stock/profile2`, cached 24h, plus one `/stock/metric` call). Fails with `provider_not_configured` without one. Cached for 6h.

```json
{ "data": { "symbol": "RKLB", "industry": "Aerospace & Defense", "country": "US", "ipoDate": "2020-11-16",
  "website": "https://rocketlabcorp.com/", "sharesOutstanding": 598460000,
  "metrics": { "marketCap": 32209104000, "enterpriseValue": 30108932000, "peTTM": null, "psTTM": 41.8764, "pb": 17.4119,
    "epsTTM": -0.2795, "revenueGrowthYoY": 52.53, "revenueGrowth5Y": 76.47, "epsGrowthYoY": null,
    "grossMarginTTM": 37.26, "operatingMarginTTM": -29.82, "netMarginTTM": -21.51, "roeTTM": -7.56,
    "currentRatio": 5.4824, "debtToEquity": 0.0084, "dividendYield": null, "payoutRatioTTM": null, "beta": 3.2037 },
  "freshness": { "provider": "finnhub", … } } }
```

Money is in the listing currency (the vendor's millions are converted to units). Percentages are in percent units (`52.53` means 52.53%). `TTM` is the trailing twelve months. Values the vendor doesn't report are `null`: `peTTM` is `null` for loss makers, and ETFs have no profile and only `beta`.

### `GET /stocks/{symbol}/candles?range=1d&warmup=true`

Default range `1d`. Candles are oldest first, and `time` is the bar open. With `warmup=true` the response adds `warmup`: the bars before `candles` (up to 900, fewer when the history is shorter), oldest first. The chart uses them to compute EMAs; sparklines leave the flag off for a smaller payload. Levels are always calculated from `candles` only.

```json
{ "data": { "symbol": "AAPL", "interval": "5min", "range": "1d", "currency": "USD", "exchangeTimezone": "America/New_York",
  "candles": [{ "time": "2026-10-23T09:30:00-04:00", "open": 349.11, "high": 351.73, "low": 349.11, "close": 350.92, "volume": 4190622 }],
  "freshness": { … } } }
```

An empty `candles` array means the provider returned no bars for the range.

### `GET /stocks/{symbol}/levels?range=3m`

Default range `3m`. Support/resistance levels calculated from that range's candles (shares the candle cache). See [support-resistance.md](support-resistance.md).

```json
{ "data": { "symbol": "AAPL", "range": "1y", "interval": "1day", "status": "ok",
  "levels": [{ "type": "resistance", "price": 348.15, "zoneLow": 348.15, "zoneHigh": 348.15, "touches": 1, "strength": 0.52, "firstTouchAt": "…", "lastTouchAt": "…" }],
  "referencePrice": 347.73, "atr": 5.21, "tolerance": 2.6, "candlesUsed": 252, "candlesDropped": 0, "swingHighs": 14, "swingLows": 13,
  "asOf": "…", "computedAt": "…",
  "method": { "name": "swing-cluster-v1", "description": "…", "parameters": { "swingWindow": 3, "atrPeriod": 14, "clusterAtrMultiple": 0.5, … } },
  "disclaimer": "Levels are calculated by Mallowtick from historical candles…", "freshness": { … } } }
```
