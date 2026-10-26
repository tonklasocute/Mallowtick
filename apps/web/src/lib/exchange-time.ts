const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Offset of timeZone from UTC at the given instant, in seconds. */
export function timeZoneOffsetSeconds(epochMs: number, timeZone: string): number {
  const parts = Object.fromEntries(
    formatterFor(timeZone)
      .formatToParts(new Date(epochMs))
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((asUtc - Math.floor(epochMs / 1000) * 1000) / 1000);
}

/**
 * Converts an instant to the "wall clock as UTC" seconds that Lightweight
 * Charts expects, so axes show exchange-local times (e.g. 9:30 for the NYSE
 * open) regardless of the viewer's time zone.
 */
export function toChartTime(iso: string, timeZone: string): number {
  const ms = new Date(iso).getTime();
  return Math.floor(ms / 1000) + timeZoneOffsetSeconds(ms, timeZone);
}
