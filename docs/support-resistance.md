# Support & resistance (swing-cluster-v1)

Implementation: `services/api/internal/supportresistance`. Tests cover each case listed below.

Levels are **calculated by Mallowtick** from the same candles the chart shows for the selected range. They are analytical estimates, not provider data, and they don't predict future prices. The API response and UI both say so.

## Algorithm

1. **Sanitize.** Drop bars that have non-finite or non-positive prices, `high < low`, or a zero time. Sort by time; for duplicate timestamps, keep the last bar. The response reports `candlesDropped`.
2. **ATR.** Wilder's Average True Range (`atrPeriod`, default 14) as of the last bar. True range includes gaps from the previous close. With fewer bars than the period, use the simple mean of the true ranges.
3. **Swing points.** Bar *i* is a swing high if its high is strictly above the previous `swingWindow` highs (default 3) and not exceeded by the next `swingWindow` highs. Swing lows are symmetric. A plateau of equal highs yields one pivot. Flat series yield none.
4. **No lookahead.** Bars within `swingWindow` of the end can't be confirmed and are ignored, so the result as of bar *t* uses only bars ≤ *t*.
5. **Cluster.** Sort pivots by price. Each cluster's spread is at most `tolerance = max(clusterAtrMultiple × ATR, minTolerancePct × reference price)`, with defaults 0.5 × ATR and a 0.1% floor. The floor handles near-zero ATR. Swing highs and lows are clustered together, so a level can change role.
6. **Score.** Each component is normalized to [0, 1], then weighted:
   - touches = min(pivots, 5) / 5 (weight 0.4)
   - recency = exp(−ln2 × barsSinceLastTouch / halfLife), where halfLife = 25% of the bar count (weight 0.3)
   - reaction = mean move away from the pivot within `swingWindow` bars, in ATRs, capped at 3 (weight 0.3)
7. **Classify & select.** The reference price is the last close. Clusters priced at or below it are support; clusters above it are resistance. Keep the `maxLevelsPerSide` (3) highest scores per side; ties go to the level nearer the price, then to the lower price.

## Output

Each level has `type`, `price` (cluster mean), `zoneLow`/`zoneHigh`, `touches`, `strength` (score 0–1), and `firstTouchAt`/`lastTouchAt`. The response also includes `status` (`ok` | `insufficient_data`), `referencePrice`, `atr`, `tolerance`, `candlesUsed`, `swingHighs`/`swingLows`, `asOf`, the full parameter set (`method.parameters`), and a disclaimer.

The UI numbers levels outward from the price (R1 = nearest resistance, S1 = nearest support), draws them as dashed price lines, and lists them in Key Levels with distance, touches, and strength.

## Assumptions and limits

- At least `2 × swingWindow + 1` valid bars are required (`insufficient_data` otherwise).
- Levels depend on the range: 1D uses 5-minute bars and 1Y uses daily bars, so they differ. Multi-timeframe confluence is **not** implemented in v1.
- Touches count confirmed pivots in a cluster, not every bar that passed near the level.
- Intraday ranges assume regular sessions; holidays and half days shift the calendar span slightly.
- Parameters live in `supportresistance.Config` (validated; defaults in `DefaultConfig()`). They aren't exposed as environment variables yet.
