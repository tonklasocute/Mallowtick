import { addDays, formatEps, hourLabel, isReported } from "@/lib/earnings";
import { formatCalendarDate, formatPrice, formatSignedPercent } from "@/lib/format";
import { safeExternalUrl } from "@/lib/links";
import { vendorLabel } from "@/lib/providers";
import { normalizeSymbol } from "@/lib/symbols";
import type { EarningsEvent, NewsArticle, Quote } from "@/types/api";

/*
 * Local-first alerts. Rules, their state and the alerts they raise live in this browser
 * only (IndexedDB); nothing is sent to the server except the tickers the app fetches data
 * for anyway. Rules are checked against data the app has just received, while it is open.
 */

export type AlertType =
  | "price_above"
  | "price_below"
  | "cross_above"
  | "cross_below"
  | "percent_move"
  | "earnings_upcoming"
  | "company_news";

export interface AlertRule {
  id: string;
  symbol: string;
  type: AlertType;
  /**
   * Price types: the price in USD. percent_move: the day's move in percent (either way).
   * earnings_upcoming: how many days ahead. company_news: unused (null).
   */
  threshold: number | null;
  enabled: boolean;
  /** The least time between two alerts of this rule. */
  cooldownMinutes: number;
  createdAt: string;
  updatedAt: string;
}

/** What a rule remembers between checks. */
export interface AlertState {
  ruleId: string;
  /** The last fresh price seen; crossings compare against it. */
  lastValue: number | null;
  lastValueAt: string | null;
  /** Whether the condition held at the last check; level rules fire when it becomes true. */
  conditionMet: boolean;
  lastTriggeredAt: string | null;
  /** Earnings dates or article ids already alerted on. */
  seenKeys: string[];
}

export interface AlertFact {
  label: string;
  value: string;
}

/** An alert raised by a rule. Its text states facts only: what happened and from where. */
export interface AlertEvent {
  /** Deterministic per trigger, so two tabs seeing the same data store one alert. */
  id: string;
  ruleId: string;
  symbol: string;
  type: AlertType;
  title: string;
  message: string;
  facts: AlertFact[];
  /** Vendor name for display. */
  source: string;
  /** The data's own time (quote time, article time). */
  dataAsOf: string | null;
  createdAt: string;
  read: boolean;
  /** Price alerts only: whether the market was open, so a closing price is labelled as such. */
  marketOpen: boolean | null;
  /** News alerts: the article's link (validated). */
  url: string | null;
}

export const ALERT_TYPES: { type: AlertType; label: string; unit: string | null }[] = [
  { type: "price_above", label: "ราคาสูงกว่า", unit: "USD" },
  { type: "price_below", label: "ราคาต่ำกว่า", unit: "USD" },
  { type: "cross_above", label: "ราคาตัดขึ้นเหนือ", unit: "USD" },
  { type: "cross_below", label: "ราคาตัดลงใต้", unit: "USD" },
  { type: "percent_move", label: "ราคาเปลี่ยนในวันเกิน", unit: "%" },
  { type: "earnings_upcoming", label: "ใกล้วันประกาศงบ", unit: "วัน" },
  { type: "company_news", label: "มีข่าวใหม่ของบริษัท", unit: null },
];

export const typeLabel = (t: AlertType) => ALERT_TYPES.find((x) => x.type === t)?.label ?? t;

export const PRICE_TYPES: readonly AlertType[] = [
  "price_above",
  "price_below",
  "cross_above",
  "cross_below",
  "percent_move",
];

/** Default cooldowns: a price level an hour, a big day move six hours. */
export function defaultCooldown(type: AlertType): number {
  if (type === "percent_move") return 360;
  if (type === "earnings_upcoming" || type === "company_news") return 0;
  return 60;
}

export const COOLDOWN_OPTIONS = [0, 15, 60, 240, 1440] as const;

export function cooldownLabel(minutes: number): string {
  if (minutes === 0) return "ไม่พัก";
  if (minutes < 60) return `${minutes} นาที`;
  if (minutes < 1440) return `${minutes / 60} ชั่วโมง`;
  return `${minutes / 1440} วัน`;
}

export const MAX_RULES = 100;
/** Alerts kept; older read ones are pruned first. */
export const MAX_EVENTS = 300;
const MAX_SEEN_KEYS = 300;

/** Validates a rule's input; returns a Thai error or null. */
export function validateRule(input: {
  symbol: string;
  type: AlertType;
  threshold: number | null;
}): string | null {
  if (!normalizeSymbol(input.symbol)) return "สัญลักษณ์หุ้นไม่ถูกต้อง";
  const t = input.threshold;
  switch (input.type) {
    case "company_news":
      return null;
    case "earnings_upcoming":
      return t !== null && Number.isInteger(t) && t >= 0 && t <= 30
        ? null
        : "ใส่จำนวนวันระหว่าง 0 ถึง 30";
    case "percent_move":
      return t !== null && Number.isFinite(t) && t > 0 && t <= 100
        ? null
        : "ใส่เปอร์เซ็นต์มากกว่า 0 และไม่เกิน 100";
    default:
      return t !== null && Number.isFinite(t) && t > 0 ? null : "ใส่ราคาที่มากกว่า 0";
  }
}

export function newRule(
  input: { symbol: string; type: AlertType; threshold: number | null; cooldownMinutes?: number },
  now: Date,
  id: string,
): AlertRule {
  const at = now.toISOString();
  return {
    id,
    symbol: normalizeSymbol(input.symbol)!,
    type: input.type,
    threshold: input.type === "company_news" ? null : input.threshold,
    enabled: true,
    cooldownMinutes: input.cooldownMinutes ?? defaultCooldown(input.type),
    createdAt: at,
    updatedAt: at,
  };
}

/** "AAPL · ราคาสูงกว่า $200.00". */
export function describeRule(rule: AlertRule): string {
  const t = rule.threshold;
  const what =
    rule.type === "company_news"
      ? typeLabel(rule.type)
      : rule.type === "percent_move"
        ? `${typeLabel(rule.type)} ±${t}%`
        : rule.type === "earnings_upcoming"
          ? `${typeLabel(rule.type)} (${t === 0 ? "วันประกาศ" : `ล่วงหน้า ${t} วัน`})`
          : `${typeLabel(rule.type)} ${formatPrice(t)}`;
  return `${rule.symbol} · ${what}`;
}

export function initialState(ruleId: string): AlertState {
  return {
    ruleId,
    lastValue: null,
    lastValueAt: null,
    conditionMet: false,
    lastTriggeredAt: null,
    seenKeys: [],
  };
}

/** A quote's data counts as fresh for this long after the server fetched it. */
export const QUOTE_MAX_AGE_MS = 15 * 60_000;

/**
 * Whether a quote may trigger an alert: not a stale fallback, with a vendor time, and
 * fetched recently. Old or stale data never raises an alert.
 */
export function isQuoteFresh(q: Quote, now: Date): boolean {
  if (q.freshness.stale || !q.asOf || !Number.isFinite(q.price) || q.price <= 0) return false;
  const fetched = Date.parse(q.freshness.fetchedAt);
  return Number.isFinite(fetched) && now.getTime() - fetched <= QUOTE_MAX_AGE_MS;
}

function cooledDown(rule: AlertRule, state: AlertState, now: Date): boolean {
  if (!state.lastTriggeredAt) return true;
  return now.getTime() - Date.parse(state.lastTriggeredAt) >= rule.cooldownMinutes * 60_000;
}

export interface Evaluation {
  state: AlertState;
  event: AlertEvent | null;
}

function priceEvent(
  rule: AlertRule,
  q: Quote,
  now: Date,
  title: string,
  facts: AlertFact[],
): AlertEvent {
  const closed = q.isMarketOpen === false;
  return {
    id: `${rule.id}:${q.asOf}`,
    ruleId: rule.id,
    symbol: rule.symbol,
    type: rule.type,
    title,
    message: closed ? "ตลาดปิดอยู่ ราคานี้คือราคาล่าสุดก่อนปิด" : "ราคาระหว่างเวลาทำการ",
    facts,
    source: vendorLabel(q.freshness.provider),
    dataAsOf: q.asOf,
    createdAt: now.toISOString(),
    read: false,
    marketOpen: q.isMarketOpen,
    url: null,
  };
}

/**
 * Checks a price rule against a quote. Level rules (above, below, day move) fire when their
 * condition becomes true, then re-arm once it is false again. Crossings need a fresh price on
 * the other side first, so the first check only records a baseline. Nothing fires within the
 * cooldown, and data that isn't fresh changes nothing.
 */
export function evaluateQuote(rule: AlertRule, state: AlertState, q: Quote, now: Date): Evaluation {
  if (!rule.enabled || !PRICE_TYPES.includes(rule.type) || q.symbol !== rule.symbol) {
    return { state, event: null };
  }
  if (!isQuoteFresh(q, now) || rule.threshold === null) return { state, event: null };
  const t = rule.threshold;
  const price = q.price;
  const next: AlertState = { ...state, lastValue: price, lastValueAt: q.asOf };
  const priceFact = { label: "ราคา", value: formatPrice(price, q.currency) };
  const fire = (title: string, facts: AlertFact[]): Evaluation =>
    cooledDown(rule, state, now)
      ? {
          state: { ...next, lastTriggeredAt: now.toISOString() },
          event: priceEvent(rule, q, now, title, facts),
        }
      : { state: next, event: null };

  switch (rule.type) {
    case "price_above":
    case "price_below": {
      const met = rule.type === "price_above" ? price >= t : price <= t;
      next.conditionMet = met;
      if (!met || state.conditionMet) return { state: next, event: null };
      return fire(
        `${rule.symbol} ราคา${rule.type === "price_above" ? "สูงกว่า" : "ต่ำกว่า"} ${formatPrice(t)}`,
        [priceFact, { label: "ระดับที่ตั้งไว้", value: formatPrice(t) }],
      );
    }
    case "cross_above":
    case "cross_below": {
      const prev = state.lastValue;
      const crossed =
        prev !== null &&
        (rule.type === "cross_above" ? prev < t && price >= t : prev > t && price <= t);
      if (!crossed) return { state: next, event: null };
      return fire(
        `${rule.symbol} ราคาตัด${rule.type === "cross_above" ? "ขึ้นเหนือ" : "ลงใต้"} ${formatPrice(t)}`,
        [
          { label: "ราคาก่อนหน้า", value: formatPrice(prev) },
          priceFact,
          { label: "ระดับที่ตั้งไว้", value: formatPrice(t) },
        ],
      );
    }
    case "percent_move": {
      const pct = q.changePercent;
      // The day's move is only news during the session: while the market is closed the
      // quote still carries the last session's change, which must not read as "today".
      if (pct === null || q.isMarketOpen !== true) return { state: next, event: null };
      const met = Math.abs(pct) >= t;
      next.conditionMet = met;
      if (!met || state.conditionMet) return { state: next, event: null };
      return fire(
        `${rule.symbol} ราคา${pct > 0 ? "ขึ้น" : "ลง"} ${formatSignedPercent(pct)} วันนี้`,
        [
          priceFact,
          { label: "เปลี่ยนจากราคาปิดก่อนหน้า", value: formatSignedPercent(pct) },
          { label: "เกณฑ์ที่ตั้งไว้", value: `±${t}%` },
        ],
      );
    }
    default:
      return { state, event: null };
  }
}

function remember(keys: string[], add: string[]): string[] {
  return [...keys, ...add.filter((k) => !keys.includes(k))].slice(-MAX_SEEN_KEYS);
}

/**
 * Checks an "upcoming earnings" rule against the symbol's calendar entries. It fires once per
 * report date within the window; when the date moves, the new date is alerted as a change.
 */
export function evaluateEarnings(
  rule: AlertRule,
  state: AlertState,
  events: EarningsEvent[],
  today: string,
  source: string,
  now: Date,
): Evaluation {
  if (!rule.enabled || rule.type !== "earnings_upcoming" || rule.threshold === null) {
    return { state, event: null };
  }
  const limit = addDays(today, rule.threshold);
  const next = events
    .filter((e) => e.symbol === rule.symbol && e.date >= today && !isReported(e))
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  if (!next || next.date > limit || state.seenKeys.includes(next.date)) {
    return { state, event: null };
  }
  const previous = state.seenKeys.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).at(-1);
  const moved = previous !== undefined && previous >= today && previous !== next.date;
  const when = next.date === today ? "วันนี้" : formatCalendarDate(next.date);
  const facts: AlertFact[] = [
    { label: "วันประกาศ (เวลาสหรัฐฯ)", value: formatCalendarDate(next.date) },
    { label: "ช่วงเวลา", value: hourLabel(next.hour) },
  ];
  if (next.epsEstimate !== null)
    facts.push({ label: "EPS คาด", value: formatEps(next.epsEstimate) });
  if (moved) facts.unshift({ label: "วันเดิม", value: formatCalendarDate(previous) });
  return {
    state: {
      ...state,
      seenKeys: remember(state.seenKeys, [next.date]),
      lastTriggeredAt: now.toISOString(),
    },
    event: {
      id: `${rule.id}:earnings:${next.date}`,
      ruleId: rule.id,
      symbol: rule.symbol,
      type: rule.type,
      title: moved
        ? `${rule.symbol} เลื่อนวันประกาศงบเป็น ${when}`
        : `${rule.symbol} ประกาศงบ${next.date === today ? "วันนี้" : ` ${when}`}`,
      message: "ตามปฏิทินประกาศงบของผู้ให้บริการ วันที่อาจเปลี่ยนได้",
      facts,
      source,
      dataAsOf: null,
      createdAt: now.toISOString(),
      read: false,
      marketOpen: null,
      url: null,
    },
  };
}

/**
 * Checks a "company news" rule: articles about the symbol published after the rule was made
 * and not alerted on yet. Several new articles make one alert, led by the newest.
 */
export function evaluateNews(
  rule: AlertRule,
  state: AlertState,
  articles: NewsArticle[],
  now: Date,
): Evaluation {
  if (!rule.enabled || rule.type !== "company_news") return { state, event: null };
  const fresh = articles
    .filter(
      (a) =>
        a.related.includes(rule.symbol) &&
        Date.parse(a.publishedAt) > Date.parse(rule.createdAt) &&
        !state.seenKeys.includes(a.id),
    )
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  const lead = fresh[0];
  if (!lead || !cooledDown(rule, state, now)) return { state, event: null };
  return {
    state: {
      ...state,
      seenKeys: remember(
        state.seenKeys,
        fresh.map((a) => a.id),
      ),
      lastTriggeredAt: now.toISOString(),
    },
    event: {
      id: `${rule.id}:news:${lead.id}`,
      ruleId: rule.id,
      symbol: rule.symbol,
      type: rule.type,
      title:
        fresh.length === 1
          ? `ข่าวใหม่ของ ${rule.symbol}`
          : `ข่าวใหม่ของ ${rule.symbol} ${fresh.length} ข่าว`,
      message: lead.headline,
      facts: [{ label: "แหล่งข่าว", value: lead.source || "ไม่ระบุแหล่งข่าว" }],
      source: vendorLabel(lead.provider),
      dataAsOf: lead.publishedAt,
      createdAt: now.toISOString(),
      read: false,
      marketOpen: null,
      url: safeExternalUrl(lead.url),
    },
  };
}

/** Keeps the newest events up to MAX_EVENTS, dropping read ones before unread ones. */
export function pruneEvents(events: AlertEvent[]): AlertEvent[] {
  const sorted = [...events].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (sorted.length <= MAX_EVENTS) return sorted;
  const unread = sorted.filter((e) => !e.read);
  const read = sorted.filter((e) => e.read);
  return [...unread, ...read]
    .slice(0, MAX_EVENTS)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
