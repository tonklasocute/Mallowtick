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
| `1m` | 1h | 154 |
| `3m` | 1day | 63 |
| `1y` | 1day | 252 |
| `5y` | 1week | 260 |

`freshness` objects are described in [market-data.md](market-data.md#freshness-model). Timestamps are RFC 3339. Candle times carry the exchange offset.

## Endpoints

### `GET /health`

Liveness and provider configuration. Always 200 while the server runs.

```json
{ "data": { "status": "ok", "time": "…", "provider": { "name": "twelvedata", "configured": true, "latency": "unknown" } } }
```

### `GET /market/status`

NYSE open/closed state from the provider.

```json
{ "data": { "exchange": "XNYS", "name": "NYSE", "isOpen": false, "opensInSeconds": 16044, "closesInSeconds": null, "freshness": { … } } }
```

### `GET /market/overview`

Quotes for `MARKET_OVERVIEW_SYMBOLS` (`benchmarks`) and `POPULAR_SYMBOLS` (`popular`), fetched in one batch. Lists are empty when not configured.

```json
{ "data": { "benchmarks": [Quote…], "popular": [Quote…], "unavailable": [{ "symbol": "DIA", "reason": "rate_limited" }] } }
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

Fields the provider didn't report are `null`.

### `GET /stocks/{symbol}/candles?range=1d`

Default range `1d`. Candles are oldest first, and `time` is the bar open.

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
