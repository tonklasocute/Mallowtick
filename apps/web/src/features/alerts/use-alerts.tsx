"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, X } from "lucide-react";
import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { addDays, marketToday } from "@/lib/earnings";
import { vendorLabel } from "@/lib/providers";
import { endpoints } from "@/services/api/endpoints";
import { NEWS_MAX_SYMBOLS } from "@/services/api/queries";
import type { EarningsCalendar, NewsArticle, NewsPage, Quote } from "@/types/api";

import {
  type AlertEvent,
  type AlertRule,
  type AlertState,
  type AlertType,
  evaluateEarnings,
  evaluateNews,
  evaluateQuote,
  type Evaluation,
  initialState,
  MAX_RULES,
  newRule,
  PRICE_TYPES,
  validateRule,
} from "./alert-model";
import { type AlertStore, createAlertStore } from "./alert-store";

/** How often the app refreshes data for alert rules while it is open and visible. */
const PRICE_CHECK_MS = 5 * 60_000;
const EVENT_CHECK_MS = 30 * 60_000;
/** Earnings rules look this far ahead (the longest window a rule may set is 30 days). */
const EARNINGS_DAYS = 31;

export interface AlertsValue {
  /** False until the store is open (always false during server rendering). */
  ready: boolean;
  rules: AlertRule[];
  events: AlertEvent[];
  unread: number;
  /** Why alerts are not saved on this device, or null. */
  notice: string | null;
  /** Alerts raised since the toast was last dismissed. */
  fresh: AlertEvent[];
  addRule: (input: {
    symbol: string;
    type: AlertType;
    threshold: number | null;
    cooldownMinutes?: number;
  }) => Promise<string | null>;
  updateRule: (rule: AlertRule) => Promise<void>;
  deleteRule: (id: string) => Promise<void>;
  markRead: (ids: string[]) => Promise<void>;
  deleteEvents: (ids: string[]) => Promise<void>;
  dismissFresh: () => void;
}

const AlertsContext = createContext<AlertsValue | null>(null);

export function useAlerts(): AlertsValue {
  const ctx = useContext(AlertsContext);
  if (!ctx) throw new Error("useAlerts must be used inside <AlertsProvider>");
  return ctx;
}

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `r-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** Fetches the data alert rules need, at a gentle pace, only while there are such rules. */
function useAlertData(rules: AlertRule[]) {
  const enabled = rules.filter((r) => r.enabled);
  const unique = (types: readonly AlertType[]) =>
    [...new Set(enabled.filter((r) => types.includes(r.type)).map((r) => r.symbol))].sort();
  const priceSymbols = unique(PRICE_TYPES).slice(0, 25);
  const earningsSymbols = unique(["earnings_upcoming"]);
  const newsSymbols = unique(["company_news"]).slice(0, NEWS_MAX_SYMBOLS);
  const client = useQueryClient();
  const today = marketToday();

  useQuery({
    queryKey: ["alert-quotes", priceSymbols.join(",")],
    queryFn: async ({ signal }) => {
      const batch = await endpoints.quotes(priceSymbols, signal);
      // The per-symbol entries are what the alert engine (and every screen) listens to.
      for (const q of batch.quotes) client.setQueryData(["quote", q.symbol], q);
      return batch;
    },
    enabled: priceSymbols.length > 0,
    refetchInterval: PRICE_CHECK_MS,
    staleTime: PRICE_CHECK_MS,
    retry: false,
  });
  useQuery({
    queryKey: [
      "earnings-calendar",
      today,
      addDays(today, EARNINGS_DAYS - 1),
      earningsSymbols.join(","),
    ],
    queryFn: ({ signal }) =>
      endpoints.earningsCalendar(today, addDays(today, EARNINGS_DAYS - 1), earningsSymbols, signal),
    enabled: earningsSymbols.length > 0,
    refetchInterval: EVENT_CHECK_MS,
    staleTime: EVENT_CHECK_MS,
    retry: false,
  });
  useQuery({
    queryKey: ["alert-news", newsSymbols.join(",")],
    queryFn: ({ signal }) => endpoints.news({ symbols: newsSymbols, limit: 50 }, signal),
    enabled: newsSymbols.length > 0,
    refetchInterval: EVENT_CHECK_MS,
    staleTime: EVENT_CHECK_MS,
    retry: false,
  });
}

/** What a successful query's data means for the rules, by its key. */
type Input =
  | { kind: "quote"; quote: Quote }
  | { kind: "earnings"; calendar: EarningsCalendar }
  | { kind: "news"; articles: NewsArticle[] };

function toInput(key: readonly unknown[], data: unknown): Input | null {
  if (!data) return null;
  switch (key[0]) {
    case "quote":
      return { kind: "quote", quote: data as Quote };
    case "earnings-calendar":
      return { kind: "earnings", calendar: data as EarningsCalendar };
    case "alert-news":
      return { kind: "news", articles: (data as NewsPage).articles };
    case "news":
      return {
        kind: "news",
        articles: ((data as { pages?: NewsPage[] }).pages ?? []).flatMap((p) => p.articles),
      };
  }
  return null;
}

function evaluate(rule: AlertRule, state: AlertState, input: Input, now: Date): Evaluation {
  switch (input.kind) {
    case "quote":
      return evaluateQuote(rule, state, input.quote, now);
    case "earnings":
      return evaluateEarnings(
        rule,
        state,
        input.calendar.events,
        input.calendar.today,
        vendorLabel(input.calendar.freshness.provider),
        now,
      );
    case "news":
      return evaluateNews(rule, state, input.articles, now);
  }
}

export function AlertsProvider({
  children,
  createStore = createAlertStore,
}: {
  children: ReactNode;
  createStore?: () => Promise<AlertStore>;
}) {
  const client = useQueryClient();
  const [store, setStore] = useState<AlertStore | null>(null);
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [fresh, setFresh] = useState<AlertEvent[]>([]);
  const rulesRef = useRef<AlertRule[]>([]);
  // Checks run one at a time, so two updates never read the same state and both fire.
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const reload = useCallback(async (s: AlertStore) => {
    const [r, e] = await Promise.all([s.listRules(), s.listEvents()]);
    rulesRef.current = r;
    setRules(r);
    setEvents(e);
  }, []);

  // The store is opened in the browser only; the server renders without alerts.
  useEffect(() => {
    let cancelled = false;
    let unsubscribe = () => {};
    void createStore().then(async (s) => {
      if (cancelled) return;
      await reload(s);
      setStore(s);
      unsubscribe = s.subscribe(() => void reload(s));
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [createStore, reload]);

  const check = useCallback(
    (input: Input) => {
      if (!store) return;
      const symbol = input.kind === "quote" ? input.quote.symbol : null;
      const relevant = rulesRef.current.filter(
        (r) =>
          r.enabled &&
          (symbol === null || r.symbol === symbol) &&
          (input.kind === "quote"
            ? PRICE_TYPES.includes(r.type)
            : input.kind === "earnings"
              ? r.type === "earnings_upcoming"
              : r.type === "company_news"),
      );
      if (relevant.length === 0) return;
      queue.current = queue.current.then(async () => {
        const states = new Map((await store.listStates()).map((s) => [s.ruleId, s]));
        const now = new Date();
        const changed: AlertState[] = [];
        const raised: AlertEvent[] = [];
        for (const rule of relevant) {
          const before = states.get(rule.id) ?? initialState(rule.id);
          const { state, event } = evaluate(rule, before, input, now);
          if (state !== before) changed.push(state);
          if (event) raised.push(event);
        }
        if (changed.length === 0 && raised.length === 0) return;
        const added = await store.commit(changed, raised);
        if (added.length > 0) {
          setFresh((f) => [...added, ...f].slice(0, 5));
          await reload(store);
        }
      });
    },
    [store, reload],
  );

  // Every successful fetch of a quote, the earnings calendar or news is checked against the
  // rules: alerts use the data the app receives anyway.
  useEffect(() => {
    if (!store) return;
    const cache = client.getQueryCache();
    const unsubscribe = cache.subscribe((e) => {
      if (e.type !== "updated" || e.action.type !== "success") return;
      const input = toInput(e.query.queryKey, e.query.state.data);
      if (input) check(input);
    });
    // Data that arrived before the store opened is checked once it is ready.
    for (const q of cache.getAll()) {
      if (q.state.status !== "success") continue;
      const input = toInput(q.queryKey, q.state.data);
      if (input) check(input);
    }
    return unsubscribe;
  }, [client, store, check]);

  useAlertData(rules);

  const value = useMemo<AlertsValue>(() => {
    const run = async (fn: (s: AlertStore) => Promise<unknown>) => {
      if (!store) return;
      await fn(store);
      await reload(store);
    };
    return {
      ready: store !== null,
      rules,
      events,
      unread: events.filter((e) => !e.read).length,
      notice: store?.notice ?? null,
      fresh,
      addRule: async (input) => {
        const error = validateRule(input);
        if (error) return error;
        if (rulesRef.current.length >= MAX_RULES)
          return `ตั้งการแจ้งเตือนได้สูงสุด ${MAX_RULES} รายการ`;
        await run((s) => s.putRule(newRule(input, new Date(), newId())));
        return null;
      },
      updateRule: (rule) => run((s) => s.putRule({ ...rule, updatedAt: new Date().toISOString() })),
      deleteRule: (id) => run((s) => s.deleteRule(id)),
      markRead: (ids) => run((s) => s.markRead(ids)),
      deleteEvents: (ids) => run((s) => s.deleteEvents(ids)),
      dismissFresh: () => setFresh([]),
    };
  }, [store, rules, events, fresh, reload]);

  return (
    <AlertsContext.Provider value={value}>
      {children}
      <AlertToast />
    </AlertsContext.Provider>
  );
}

/** A banner for alerts just raised; the full list is on the alerts screen. */
function AlertToast() {
  const { fresh, dismissFresh } = useAlerts();
  const latest = fresh[0];
  useEffect(() => {
    if (!latest) return;
    const t = setTimeout(dismissFresh, 8_000);
    return () => clearTimeout(t);
  }, [latest, dismissFresh]);
  if (!latest) return null;
  return (
    <div className="pt-safe pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-3">
      <div
        role="status"
        className="pointer-events-auto mt-2 flex w-full max-w-md items-start gap-3 rounded-2xl bg-ink px-3.5 py-3 text-surface shadow-float"
      >
        <BellRing aria-hidden className="mt-0.5 size-5 shrink-0 text-mint" />
        <Link href="/alerts" onClick={dismissFresh} className="min-w-0 flex-1">
          <p className="text-[14px] font-medium">{latest.title}</p>
          <p className="truncate text-[12px] font-light opacity-80">
            {fresh.length > 1
              ? `และการแจ้งเตือนอื่นอีก ${fresh.length - 1} รายการ`
              : latest.message}
          </p>
        </Link>
        <button
          type="button"
          aria-label="ปิดการแจ้งเตือน"
          onClick={dismissFresh}
          className="grid size-8 shrink-0 place-items-center rounded-full hover:bg-surface/10"
        >
          <X aria-hidden className="size-4" />
        </button>
      </div>
    </div>
  );
}
