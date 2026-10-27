import { unavailableReasonLabel } from "@/lib/unavailable-reason";
import type { SectorPeriod, SectorsResult } from "@/types/api";

import type { UnavailableItem } from "./overview-model";

/**
 * Thai names of the S&P 500 (GICS) sectors by their SPDR ETF. Keyed by symbol rather
 * than the API's sector key because unavailable entries carry only the symbol.
 */
const SECTOR_NAMES: Record<string, string> = {
  XLE: "พลังงาน",
  XLB: "วัสดุ",
  XLI: "อุตสาหกรรม",
  XLY: "สินค้าฟุ่มเฟือย",
  XLP: "สินค้าจำเป็น",
  XLV: "สุขภาพ",
  XLF: "การเงิน",
  XLK: "เทคโนโลยี",
  XLC: "สื่อสาร",
  XLU: "สาธารณูปโภค",
  XLRE: "อสังหาริมทรัพย์",
};

/**
 * Shorter names for the 1×1 heatmap tiles (61px of text at 12px), where the full one
 * would be cut off. "ฟุ่มเฟือย" is the canvas's; the others were measured in Mitr.
 */
const SHORT_NAMES: Record<string, string> = {
  XLY: "ฟุ่มเฟือย",
  XLI: "อุตสาหฯ",
  XLU: "สาธารณูปฯ",
  XLRE: "อสังหาฯ",
};

/** Tab labels stay English like the chart ranges; `title` names the period in Thai. */
export const SECTOR_PERIODS: readonly { value: SectorPeriod; label: string; title: string }[] = [
  { value: "1d", label: "1D", title: "วันนี้" },
  { value: "1w", label: "1W", title: "1 สัปดาห์" },
  { value: "3m", label: "3M", title: "3 เดือน" },
  { value: "ytd", label: "YTD", title: "ตั้งแต่ต้นปี" },
  { value: "1y", label: "1Y", title: "1 ปี" },
];

export interface SectorRow {
  symbol: string;
  name: string;
  shortName: string;
  /** The sector's return over the period, in percent. */
  value: number | null;
  /** value minus the S&P 500's, in percentage points; null without both. */
  relative: number | null;
  /** Part of the row hit the rate limit; the next poll fills it in. */
  waiting: boolean;
}

export interface SectorModel {
  /** The S&P 500's return over the period. */
  benchmark: number | null;
  /** Strongest first; sectors without a value for the period last. */
  rows: SectorRow[];
  /** Sectors with no data at all; half-fetched ones are rows with `waiting`. */
  unavailable: (UnavailableItem & { name: string })[];
}

/**
 * Label of a symbol missing for `code`. The rate limit is a wait, not a failure: a cold
 * API start needs a little more than Finnhub's 60 calls a minute, and useSectors asks
 * again sooner until everything is in.
 */
const missingLabel = (code: string) =>
  code === "rate_limited" ? "รอโควตา กำลังโหลดใหม่" : unavailableReasonLabel(code);

const isNum = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);

const sectorName = (symbol: string) => SECTOR_NAMES[symbol] ?? symbol;

/**
 * Ranks the sectors by their return over one period. The S&P 500's return is the same
 * for every sector, so this is also the order of the gap to the index.
 */
export function buildSectorModel(res: SectorsResult, period: SectorPeriod): SectorModel {
  const benchmark = res.benchmark?.returns[period] ?? null;
  const limited = new Set(
    res.unavailable.filter((u) => u.reason === "rate_limited").map((u) => u.symbol),
  );
  const rows = res.sectors.map((s): SectorRow => {
    const value = s.returns[period];
    return {
      symbol: s.symbol,
      name: sectorName(s.symbol),
      shortName: SHORT_NAMES[s.symbol] ?? sectorName(s.symbol),
      value,
      relative: isNum(value) && isNum(benchmark) ? value - benchmark : null,
      waiting: limited.has(s.symbol),
    };
  });
  rows.sort((a, b) => {
    if (!isNum(a.value) || !isNum(b.value)) return Number(isNum(b.value)) - Number(isNum(a.value));
    return b.value - a.value;
  });
  const shown = new Set(res.sectors.map((s) => s.symbol));
  const unavailable = res.unavailable
    .filter((u) => u.symbol !== "SPY" && !shown.has(u.symbol))
    .map((u) => ({
      symbol: u.symbol,
      code: u.reason,
      label: missingLabel(u.reason),
      name: sectorName(u.symbol),
    }));
  return { benchmark, rows, unavailable };
}

/**
 * Heatmap step 0–5 for a gap to the S&P 500 in points: ≥ +10, +5…+10, +1…+5, -1…+1,
 * -5…-1, ≤ -5. Without the index's return the sector's own return is graded instead.
 */
export function heatLevel(points: number): 0 | 1 | 2 | 3 | 4 | 5 {
  if (points >= 10) return 5;
  if (points >= 5) return 4;
  if (points >= 1) return 3;
  if (points > -1) return 2;
  if (points > -5) return 1;
  return 0;
}

export type TileSize = "xl" | "wide" | "one";

/**
 * Tile sizes in a 4-column mosaic, strongest first: the leader 2×2, the runner-up 2
 * wide, the rest 1×1, and as many of the last tiles 2 wide as it takes to fill the
 * bottom row (two with the canvas's ten sectors, one with eleven).
 */
export function tileSizes(count: number): TileSize[] {
  if (count <= 0) return [];
  const sizes: TileSize[] = Array.from({ length: count }, (_, i) =>
    i === 0 ? "xl" : i === 1 ? "wide" : "one",
  );
  const cells = 4 + (count > 1 ? 2 : 0) + Math.max(count - 2, 0);
  let fill = (4 - (cells % 4)) % 4;
  for (let i = count - 1; i >= 2 && fill > 0; i--, fill--) sizes[i] = "wide";
  return sizes;
}
