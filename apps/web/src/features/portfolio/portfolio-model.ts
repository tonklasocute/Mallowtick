import { MAX_WATCHLIST_SYMBOLS } from "@/lib/config";
import { normalizeSymbol } from "@/lib/symbols";
import type { Quote } from "@/types/api";

export type Currency = "THB" | "USD";

/** One position, as the user entered it. Prices are in USD, the listing currency. */
export interface Holding {
  symbol: string;
  /** Shares held; fractional shares are allowed. */
  shares: number;
  /** Average cost per share. */
  avgCost: number;
  /** Baht per dollar when bought; null values the cost at today's rate. */
  buyRate: number | null;
  targetPrice: number | null;
  stopLoss: number | null;
  /** Target share of the portfolio, in percent. */
  targetWeight: number | null;
}

export interface PortfolioGoal {
  amount: number;
  currency: Currency;
}

export interface Portfolio {
  holdings: Holding[];
  goal: PortfolioGoal | null;
  /** The currency the screen shows. */
  currency: Currency;
}

export const EMPTY_PORTFOLIO: Portfolio = { holdings: [], goal: null, currency: "THB" };

/** All holdings are priced with one batch quote request, which takes this many symbols. */
export const MAX_HOLDINGS = MAX_WATCHLIST_SYMBOLS;

const positive = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;

const isCurrency = (v: unknown): v is Currency => v === "THB" || v === "USD";

function sanitizeHolding(raw: unknown): Holding | null {
  if (!raw || typeof raw !== "object") return null;
  const h = raw as Record<string, unknown>;
  const symbol = typeof h.symbol === "string" ? normalizeSymbol(h.symbol) : null;
  const shares = positive(h.shares);
  const avgCost = positive(h.avgCost);
  if (!symbol || shares === null || avgCost === null) return null;
  const weight = typeof h.targetWeight === "number" && h.targetWeight >= 0 && h.targetWeight <= 100;
  return {
    symbol,
    shares,
    avgCost,
    buyRate: positive(h.buyRate),
    targetPrice: positive(h.targetPrice),
    stopLoss: positive(h.stopLoss),
    targetWeight: weight ? (h.targetWeight as number) : null,
  };
}

/** Keeps what is valid from stored data: unknown or broken fields are dropped, not guessed. */
export function sanitizePortfolio(raw: unknown): Portfolio {
  if (!raw || typeof raw !== "object") return EMPTY_PORTFOLIO;
  const p = raw as Record<string, unknown>;
  const holdings: Holding[] = [];
  for (const item of Array.isArray(p.holdings) ? p.holdings : []) {
    const h = sanitizeHolding(item);
    if (h && !holdings.some((x) => x.symbol === h.symbol)) holdings.push(h);
    if (holdings.length === MAX_HOLDINGS) break;
  }
  const g = p.goal as Record<string, unknown> | null | undefined;
  const amount = positive(g?.amount);
  return {
    holdings,
    goal: amount !== null && isCurrency(g?.currency) ? { amount, currency: g.currency } : null,
    currency: isCurrency(p.currency) ? p.currency : "THB",
  };
}

export class PortfolioFullError extends Error {
  constructor() {
    super(`เก็บหุ้นในพอร์ตได้สูงสุด ${MAX_HOLDINGS} ตัว`);
    this.name = "PortfolioFullError";
  }
}

/** Adds a holding or replaces the one with the same symbol, keeping its place. */
export function upsertHolding(p: Portfolio, h: Holding): Portfolio {
  const i = p.holdings.findIndex((x) => x.symbol === h.symbol);
  if (i >= 0) return { ...p, holdings: p.holdings.map((x, j) => (j === i ? h : x)) };
  if (p.holdings.length >= MAX_HOLDINGS) throw new PortfolioFullError();
  return { ...p, holdings: [...p.holdings, h] };
}

export function removeHolding(p: Portfolio, symbol: string): Portfolio {
  return { ...p, holdings: p.holdings.filter((x) => x.symbol !== symbol) };
}

/**
 * A typed number such as "1,000.50" or "฿250": null when the field is empty, NaN when it
 * is not a number.
 */
export function parseDecimal(input: string): number | null {
  const s = input.replace(/[\s,฿$%]/g, "");
  if (s === "") return null;
  return /^\d*\.?\d+$|^\d+\.$/.test(s) ? Number(s) : NaN;
}

/** "฿431,387" or "$13,024.98"; `signed` adds "+" to gains. */
export function formatMoney(value: number, currency: Currency, signed = false): string {
  const sign = value < 0 ? "-" : signed && value > 0 ? "+" : "";
  const abs = Math.abs(value);
  if (currency === "THB") {
    return `${sign}฿${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(abs)}`;
  }
  return `${sign}$${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(abs)}`;
}

/** Converts an amount between baht and dollars; null when the rate is unknown. */
export function convert(amount: number, from: Currency, to: Currency, rate: number | null) {
  if (from === to) return amount;
  if (rate === null) return null;
  return from === "USD" ? amount * rate : amount / rate;
}

export interface HoldingValue {
  holding: Holding;
  quote: Quote | null;
  /** Market value, cost and gain in the display currency; null without a price. */
  value: number | null;
  cost: number | null;
  pl: number | null;
  plPct: number | null;
  /** Share of the priced holdings' value, in percent. */
  weight: number | null;
}

export interface PortfolioValuation {
  /** The currency the figures are in: dollars when baht were asked for without a rate. */
  currency: Currency;
  rows: HoldingValue[];
  total: number;
  cost: number;
  pl: number;
  plPct: number | null;
  /** Today's change of the priced holdings, in percent; null when no quote reports it. */
  dayPct: number | null;
  /** In baht only, the gain split into the share price's part and the exchange rate's. */
  stockPart: number | null;
  fxPart: number | null;
  /** Symbols without a price, left out of every total. */
  unpriced: string[];
  goal: { amount: number; progress: number; left: number } | null;
}

/**
 * Values the portfolio from live quotes. In baht, the value uses today's rate and the cost
 * the rate at purchase when one was entered, so the gain includes the exchange rate's move.
 */
export function valuePortfolio(
  p: Portfolio,
  quotes: ReadonlyMap<string, Quote>,
  rate: number | null,
): PortfolioValuation {
  const currency: Currency = p.currency === "THB" && rate !== null ? "THB" : "USD";
  const thb = currency === "THB";
  const fx = thb ? rate! : 1;
  let total = 0;
  let cost = 0;
  let day = 0;
  let dayKnown = false;
  let stockPart = 0;
  let fxPart = 0;
  const unpriced: string[] = [];
  const rows: HoldingValue[] = p.holdings.map((h) => {
    const quote = quotes.get(h.symbol) ?? null;
    if (!quote) {
      unpriced.push(h.symbol);
      return { holding: h, quote, value: null, cost: null, pl: null, plPct: null, weight: null };
    }
    const buyRate = thb ? (h.buyRate ?? rate!) : 1;
    const value = h.shares * quote.price * fx;
    const c = h.shares * h.avgCost * buyRate;
    total += value;
    cost += c;
    if (quote.change !== null) {
      day += quote.change * h.shares * fx;
      dayKnown = true;
    }
    if (thb) {
      stockPart += (quote.price - h.avgCost) * h.shares * rate!;
      fxPart += h.shares * h.avgCost * (rate! - buyRate);
    }
    return {
      holding: h,
      quote,
      value,
      cost: c,
      pl: value - c,
      plPct: ((value - c) / c) * 100,
      weight: null,
    };
  });
  for (const r of rows) if (r.value !== null && total > 0) r.weight = (r.value / total) * 100;
  rows.sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));

  const pl = total - cost;
  let goal: PortfolioValuation["goal"] = null;
  const goalAmount = p.goal ? convert(p.goal.amount, p.goal.currency, currency, rate) : null;
  if (goalAmount !== null && goalAmount > 0 && total > 0) {
    goal = {
      amount: goalAmount,
      progress: Math.min((total / goalAmount) * 100, 100),
      left: Math.max(((goalAmount - total) / total) * 100, 0),
    };
  }
  return {
    currency,
    rows,
    total,
    cost,
    pl,
    plPct: cost > 0 ? (pl / cost) * 100 : null,
    dayPct: dayKnown && total - day > 0 ? (day / (total - day)) * 100 : null,
    stockPart: thb ? stockPart : null,
    fxPart: thb ? fxPart : null,
    unpriced,
    goal,
  };
}

export interface Slice {
  label: string;
  /** Percent of the priced value. */
  pct: number;
}

/** Donut slices, largest first; past six holdings the smallest are grouped as "อื่น ๆ". */
export function allocationSlices(v: PortfolioValuation): Slice[] {
  const priced = v.rows.filter((r) => r.weight !== null);
  const slices = priced.map((r) => ({ label: r.holding.symbol, pct: r.weight! }));
  if (slices.length <= 6) return slices;
  const rest = slices.slice(5).reduce((s, x) => s + x.pct, 0);
  return [...slices.slice(0, 5), { label: "อื่น ๆ", pct: rest }];
}
