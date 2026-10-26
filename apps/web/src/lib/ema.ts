/**
 * Exponential moving average of `values`. The first value is the simple
 * average of the first `period` values (the usual seed); earlier positions
 * are null because there is not enough data yet. Non-finite inputs are
 * skipped and yield null at their position.
 */
export function ema(values: readonly number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (!Number.isInteger(period) || period < 1) return out;
  const k = 2 / (period + 1);
  let prev: number | null = null;
  let seedSum = 0;
  let seedCount = 0;
  values.forEach((v, i) => {
    if (!Number.isFinite(v)) return;
    if (prev === null) {
      seedSum += v;
      seedCount += 1;
      if (seedCount === period) prev = seedSum / period;
      else return;
    } else {
      prev = v * k + prev * (1 - k);
    }
    out[i] = prev;
  });
  return out;
}

export const EMA_MIN_PERIOD = 2;
export const EMA_MAX_PERIOD = 300;
