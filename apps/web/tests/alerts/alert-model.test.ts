import { describe, expect, it } from "vitest";

import {
  type AlertEvent,
  type AlertRule,
  type AlertState,
  evaluateEarnings,
  evaluateNews,
  evaluateQuote,
  initialState,
  isQuoteFresh,
  MAX_EVENTS,
  newRule,
  pruneEvents,
  validateRule,
} from "@/features/alerts/alert-model";
import type { EarningsEvent, Quote } from "@/types/api";

import { freshness, quote } from "../fixtures";
import { newsArticle } from "../news/fixtures";

const T0 = new Date("2026-10-23T19:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

/** A fresh quote fetched at `when`, priced `price`. */
function q(price: number, when: Date, extra: Partial<Quote> = {}): Quote {
  return quote({
    price,
    asOf: when.toISOString(),
    freshness: freshness({ fetchedAt: when.toISOString(), stale: false }),
    ...extra,
  });
}

function rule(type: AlertRule["type"], threshold: number | null, cooldownMinutes = 60): AlertRule {
  return newRule({ symbol: "AAPL", type, threshold, cooldownMinutes }, T0, `r-${type}`);
}

/** Runs quotes through a rule in order, returning the titles of the alerts raised. */
function run(r: AlertRule, steps: [number, Date, Partial<Quote>?][]): string[] {
  let state: AlertState = initialState(r.id);
  const titles: string[] = [];
  for (const [price, when, extra] of steps) {
    const res = evaluateQuote(r, state, q(price, when, extra), when);
    state = res.state;
    if (res.event) titles.push(res.event.title);
  }
  return titles;
}

describe("price alerts", () => {
  it("fires 'above' once when it becomes true and re-arms after falling back", () => {
    const r = rule("price_above", 200, 0);
    expect(
      run(r, [
        [199, at(0)],
        [201, at(1)],
        [205, at(2)], // still above: no repeat
        [198, at(3)], // re-armed
        [202, at(4)],
      ]),
    ).toEqual(["AAPL ราคาสูงกว่า $200.00", "AAPL ราคาสูงกว่า $200.00"]);
  });

  it("respects the cooldown", () => {
    const r = rule("price_below", 100, 60);
    expect(
      run(r, [
        [99, at(0)],
        [101, at(5)],
        [99, at(10)], // within the hour: not again
        [101, at(70)],
        [99, at(80)],
      ]),
    ).toEqual(["AAPL ราคาต่ำกว่า $100.00", "AAPL ราคาต่ำกว่า $100.00"]);
  });

  it("needs a price on the other side before a crossing counts", () => {
    const r = rule("cross_above", 200, 0);
    // Already above when first seen: a baseline, not a crossing.
    expect(
      run(r, [
        [210, at(0)],
        [215, at(1)],
      ]),
    ).toEqual([]);
    expect(
      run(r, [
        [190, at(0)],
        [200, at(1)],
        [199, at(2)],
        [200.5, at(3)],
      ]),
    ).toEqual(["AAPL ราคาตัดขึ้นเหนือ $200.00", "AAPL ราคาตัดขึ้นเหนือ $200.00"]);
    expect(
      run(rule("cross_below", 50, 0), [
        [51, at(0)],
        [49, at(1)],
      ]),
    ).toEqual(["AAPL ราคาตัดลงใต้ $50.00"]);
  });

  it("fires on a big day move either way, and never without a change", () => {
    const r = rule("percent_move", 3, 0);
    expect(run(r, [[100, at(0), { changePercent: -3.4 }]])).toEqual(["AAPL ราคาลง -3.40% วันนี้"]);
    expect(run(r, [[100, at(0), { changePercent: null }]])).toEqual([]);
    expect(run(r, [[100, at(0), { changePercent: 2.99 }]])).toEqual([]);
  });

  it("never reports the last session's move as today's while the market is closed", () => {
    const r = rule("percent_move", 3, 0);
    expect(run(r, [[100, at(0), { changePercent: 4, isMarketOpen: false }]])).toEqual([]);
    expect(run(r, [[100, at(0), { changePercent: 4, isMarketOpen: null }]])).toEqual([]);
  });

  it("ignores stale, old or unpriced quotes and changes nothing", () => {
    const r = rule("price_above", 200, 0);
    const s = initialState(r.id);
    const stale = q(250, at(0), {
      freshness: freshness({ fetchedAt: at(0).toISOString(), stale: true }),
    });
    const old = q(250, at(0));
    const noTime = q(250, at(0), { asOf: null });
    for (const [quoteIn, now] of [
      [stale, at(0)],
      [old, at(16)], // fetched 16 minutes ago
      [noTime, at(0)],
    ] as const) {
      expect(isQuoteFresh(quoteIn, now)).toBe(false);
      expect(evaluateQuote(r, s, quoteIn, now)).toEqual({ state: s, event: null });
    }
  });

  it("labels a closing price and keeps one alert id per quote", () => {
    const r = rule("price_above", 200, 0);
    const res = evaluateQuote(r, initialState(r.id), q(201, at(0), { isMarketOpen: false }), at(0));
    expect(res.event?.message).toBe("ตลาดปิดอยู่ ราคานี้คือราคาล่าสุดก่อนปิด");
    expect(res.event?.id).toBe(`${r.id}:${at(0).toISOString()}`);
    expect(res.event?.facts).toContainEqual({ label: "ราคา", value: "$201.00" });
  });

  it("does nothing when disabled", () => {
    const r = { ...rule("price_above", 200, 0), enabled: false };
    expect(
      run(r, [
        [199, at(0)],
        [201, at(1)],
      ]),
    ).toEqual([]);
  });
});

function earnings(date: string, extra: Partial<EarningsEvent> = {}): EarningsEvent {
  return {
    symbol: "AAPL",
    date,
    hour: "amc",
    epsEstimate: 2.95,
    revenueEstimate: null,
    epsActual: null,
    revenueActual: null,
    ...extra,
  };
}

describe("earnings alerts", () => {
  const r = rule("earnings_upcoming", 7);

  it("fires once per report date inside the window", () => {
    let s = initialState(r.id);
    expect(
      evaluateEarnings(r, s, [earnings("2026-11-05")], "2026-10-23", "Finnhub", T0).event,
    ).toBeNull();
    const first = evaluateEarnings(r, s, [earnings("2026-10-29")], "2026-10-23", "Finnhub", T0);
    expect(first.event?.title).toBe("AAPL ประกาศงบ 29 ต.ค. 2026");
    s = first.state;
    expect(
      evaluateEarnings(r, s, [earnings("2026-10-29")], "2026-10-24", "Finnhub", T0).event,
    ).toBeNull();
  });

  it("says so when the date moves", () => {
    const first = evaluateEarnings(
      r,
      initialState(r.id),
      [earnings("2026-10-29")],
      "2026-10-23",
      "Finnhub",
      T0,
    );
    const moved = evaluateEarnings(
      r,
      first.state,
      [earnings("2026-10-30")],
      "2026-10-24",
      "Finnhub",
      T0,
    );
    expect(moved.event?.title).toBe("AAPL เลื่อนวันประกาศงบเป็น 30 ต.ค. 2026");
    expect(moved.event?.facts[0]).toEqual({ label: "วันเดิม", value: "29 ต.ค. 2026" });
  });

  it("ignores reports that are already out", () => {
    const res = evaluateEarnings(
      r,
      initialState(r.id),
      [earnings("2026-10-23", { epsActual: 2.1 })],
      "2026-10-23",
      "Finnhub",
      T0,
    );
    expect(res.event).toBeNull();
  });
});

describe("news alerts", () => {
  const r = rule("company_news", null, 0);

  it("alerts on articles after the rule was made, once each", () => {
    const old = newsArticle({ id: "fh-1", publishedAt: "2026-10-23T18:00:00Z" });
    const fresh1 = newsArticle({
      id: "fh-2",
      headline: "First new story",
      publishedAt: "2026-10-23T19:30:00Z",
    });
    const fresh2 = newsArticle({
      id: "fh-3",
      headline: "Second new story",
      publishedAt: "2026-10-23T19:45:00Z",
    });
    const first = evaluateNews(r, initialState(r.id), [old, fresh1, fresh2], at(50));
    expect(first.event?.title).toBe("ข่าวใหม่ของ AAPL 2 ข่าว");
    expect(first.event?.message).toBe("Second new story");
    expect(first.event?.url).toBe(fresh2.url);
    expect(evaluateNews(r, first.state, [old, fresh1, fresh2], at(60)).event).toBeNull();
  });

  it("never links an unsafe URL", () => {
    const bad = newsArticle({
      id: "fh-9",
      url: "javascript:x",
      publishedAt: "2026-10-23T19:30:00Z",
    });
    expect(evaluateNews(r, initialState(r.id), [bad], at(40)).event?.url).toBeNull();
  });
});

describe("rules and history", () => {
  it("validates input in Thai", () => {
    expect(validateRule({ symbol: "aapl", type: "price_above", threshold: 200 })).toBeNull();
    expect(validateRule({ symbol: "bad symbol", type: "price_above", threshold: 200 })).toBe(
      "สัญลักษณ์หุ้นไม่ถูกต้อง",
    );
    expect(validateRule({ symbol: "AAPL", type: "price_above", threshold: 0 })).toBe(
      "ใส่ราคาที่มากกว่า 0",
    );
    expect(validateRule({ symbol: "AAPL", type: "percent_move", threshold: null })).not.toBeNull();
    expect(
      validateRule({ symbol: "AAPL", type: "earnings_upcoming", threshold: 2.5 }),
    ).not.toBeNull();
    expect(validateRule({ symbol: "AAPL", type: "company_news", threshold: null })).toBeNull();
  });

  it("prunes read alerts before unread ones", () => {
    const events: AlertEvent[] = Array.from({ length: MAX_EVENTS + 5 }, (_, i) => ({
      id: `e${i}`,
      ruleId: "r",
      symbol: "AAPL",
      type: "price_above",
      title: "t",
      message: "",
      facts: [],
      source: "",
      dataAsOf: null,
      createdAt: new Date(T0.getTime() + i * 1000).toISOString(),
      read: i >= 10, // the ten oldest are unread
      marketOpen: null,
      url: null,
    }));
    const kept = pruneEvents(events);
    expect(kept).toHaveLength(MAX_EVENTS);
    expect(kept.filter((e) => !e.read)).toHaveLength(10);
  });
});
