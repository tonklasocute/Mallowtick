import {
  type AlertEvent,
  type AlertRule,
  type AlertState,
  type AlertType,
  ALERT_TYPES,
  MAX_EVENTS,
  pruneEvents,
} from "./alert-model";

/**
 * Storage boundary for alerts, like the watchlist's repository: the UI talks to this
 * interface. The browser implementation is IndexedDB; a memory store stands in where
 * IndexedDB is unavailable (or holds data from a newer version of the app).
 */
export interface AlertStore {
  /** Why alerts are kept in memory only, for the UI; null when they persist. */
  readonly notice: string | null;
  listRules(): Promise<AlertRule[]>;
  putRule(rule: AlertRule): Promise<void>;
  /** Deletes the rule and its state; alerts it raised stay in the history. */
  deleteRule(id: string): Promise<void>;
  listStates(): Promise<AlertState[]>;
  /** Newest first. */
  listEvents(): Promise<AlertEvent[]>;
  /**
   * Saves rule states and new alerts in one transaction. An alert already stored (same id,
   * e.g. raised by another tab from the same data) is not stored again. Returns the alerts
   * actually added.
   */
  commit(states: AlertState[], events: AlertEvent[]): Promise<AlertEvent[]>;
  markRead(ids: string[]): Promise<void>;
  deleteEvents(ids: string[]): Promise<void>;
  /** Notifies about changes made by other tabs. */
  subscribe(onChange: () => void): () => void;
}

export const DB_NAME = "mallowtick";
/** Bump with an upgrade step in `upgrade`; never delete stores holding user data. */
export const DB_VERSION = 1;
const RULES = "alertRules";
const EVENTS = "alertEvents";
const STATE = "alertState";
const META = "meta";
const CHANNEL = "mallowtick-alerts";

const TYPES = new Set<AlertType>(ALERT_TYPES.map((t) => t.type));
const isStr = (v: unknown): v is string => typeof v === "string";
const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Keeps a stored rule only when it is complete; nothing is guessed. */
export function sanitizeRule(raw: unknown): AlertRule | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isStr(r.id) || !isStr(r.symbol) || !TYPES.has(r.type as AlertType)) return null;
  if (!isStr(r.createdAt) || !isStr(r.updatedAt) || typeof r.enabled !== "boolean") return null;
  const cooldown = numOrNull(r.cooldownMinutes);
  return {
    id: r.id,
    symbol: r.symbol,
    type: r.type as AlertType,
    threshold: numOrNull(r.threshold),
    enabled: r.enabled,
    cooldownMinutes: cooldown !== null && cooldown >= 0 ? cooldown : 0,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function sanitizeState(raw: unknown): AlertState | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  if (!isStr(s.ruleId)) return null;
  return {
    ruleId: s.ruleId,
    lastValue: numOrNull(s.lastValue),
    lastValueAt: isStr(s.lastValueAt) ? s.lastValueAt : null,
    conditionMet: s.conditionMet === true,
    lastTriggeredAt: isStr(s.lastTriggeredAt) ? s.lastTriggeredAt : null,
    seenKeys: Array.isArray(s.seenKeys) ? s.seenKeys.filter(isStr) : [],
  };
}

function sanitizeEvent(raw: unknown): AlertEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  if (!isStr(e.id) || !isStr(e.ruleId) || !isStr(e.symbol) || !isStr(e.title)) return null;
  if (!isStr(e.createdAt) || !TYPES.has(e.type as AlertType)) return null;
  return {
    id: e.id,
    ruleId: e.ruleId,
    symbol: e.symbol,
    type: e.type as AlertType,
    title: e.title,
    message: isStr(e.message) ? e.message : "",
    facts: Array.isArray(e.facts)
      ? e.facts.filter(
          (f): f is { label: string; value: string } =>
            !!f && isStr((f as { label: unknown }).label) && isStr((f as { value: unknown }).value),
        )
      : [],
    source: isStr(e.source) ? e.source : "",
    dataAsOf: isStr(e.dataAsOf) ? e.dataAsOf : null,
    createdAt: e.createdAt,
    read: e.read === true,
    marketOpen: typeof e.marketOpen === "boolean" ? e.marketOpen : null,
    url: isStr(e.url) ? e.url : null,
  };
}

const keep = <T>(items: unknown[], fn: (x: unknown) => T | null): T[] =>
  items.map(fn).filter((x): x is T => x !== null);

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
  });
}

/**
 * Creates what a database of `oldVersion` lacks. Each step only adds; existing stores and
 * their records are never dropped, so opening twice or upgrading later keeps user data.
 */
export function upgrade(db: IDBDatabase, oldVersion: number): void {
  if (oldVersion < 1) {
    if (!db.objectStoreNames.contains(RULES)) db.createObjectStore(RULES, { keyPath: "id" });
    if (!db.objectStoreNames.contains(EVENTS)) {
      db.createObjectStore(EVENTS, { keyPath: "id" }).createIndex("createdAt", "createdAt");
    }
    if (!db.objectStoreNames.contains(STATE)) db.createObjectStore(STATE, { keyPath: "ruleId" });
    if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "key" });
  }
}

/** Thrown when the database was created by a newer version of the app. */
export class NewerDatabaseError extends Error {
  constructor() {
    super("alerts database is from a newer app version");
    this.name = "NewerDatabaseError";
  }
}

export function openAlertDb(factory: IDBFactory = indexedDB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      upgrade(db, e.oldVersion);
      req.transaction?.objectStore(META).put({ key: "schema", version: DB_VERSION });
    };
    req.onsuccess = () => {
      const db = req.result;
      // Let a newer version of the app in another tab upgrade the database.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () =>
      reject(req.error?.name === "VersionError" ? new NewerDatabaseError() : req.error);
    req.onblocked = () => reject(new Error("alerts database upgrade blocked by another tab"));
  });
}

function channel(): BroadcastChannel | null {
  return typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL);
}

export class IndexedDbAlertStore implements AlertStore {
  readonly notice = null;
  private readonly bc = channel();

  constructor(private readonly db: IDBDatabase) {}

  private changed() {
    this.bc?.postMessage("changed");
  }

  async listRules(): Promise<AlertRule[]> {
    const tx = this.db.transaction(RULES);
    const all = await request(tx.objectStore(RULES).getAll());
    return keep(all, sanitizeRule).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async putRule(rule: AlertRule): Promise<void> {
    const tx = this.db.transaction(RULES, "readwrite");
    tx.objectStore(RULES).put(rule);
    await finished(tx);
    this.changed();
  }

  async deleteRule(id: string): Promise<void> {
    const tx = this.db.transaction([RULES, STATE], "readwrite");
    tx.objectStore(RULES).delete(id);
    tx.objectStore(STATE).delete(id);
    await finished(tx);
    this.changed();
  }

  async listStates(): Promise<AlertState[]> {
    const tx = this.db.transaction(STATE);
    return keep(await request(tx.objectStore(STATE).getAll()), sanitizeState);
  }

  async listEvents(): Promise<AlertEvent[]> {
    const tx = this.db.transaction(EVENTS);
    const all = keep(await request(tx.objectStore(EVENTS).getAll()), sanitizeEvent);
    return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async commit(states: AlertState[], events: AlertEvent[]): Promise<AlertEvent[]> {
    const tx = this.db.transaction([STATE, EVENTS], "readwrite");
    const done = finished(tx);
    const stateStore = tx.objectStore(STATE);
    const eventStore = tx.objectStore(EVENTS);
    for (const s of states) stateStore.put(s);
    const added: AlertEvent[] = [];
    for (const e of events) {
      if ((await request(eventStore.getKey(e.id))) === undefined) {
        eventStore.put(e);
        added.push(e);
      }
    }
    if (added.length > 0 && (await request(eventStore.count())) > MAX_EVENTS) {
      const all = keep(await request(eventStore.getAll()), sanitizeEvent);
      const kept = new Set(pruneEvents(all).map((e) => e.id));
      for (const e of all) if (!kept.has(e.id)) eventStore.delete(e.id);
    }
    await done;
    if (added.length > 0 || states.length > 0) this.changed();
    return added;
  }

  async markRead(ids: string[]): Promise<void> {
    const tx = this.db.transaction(EVENTS, "readwrite");
    const done = finished(tx);
    const store = tx.objectStore(EVENTS);
    for (const id of ids) {
      const e = sanitizeEvent(await request(store.get(id)));
      if (e && !e.read) store.put({ ...e, read: true });
    }
    await done;
    this.changed();
  }

  async deleteEvents(ids: string[]): Promise<void> {
    const tx = this.db.transaction(EVENTS, "readwrite");
    for (const id of ids) tx.objectStore(EVENTS).delete(id);
    await finished(tx);
    this.changed();
  }

  subscribe(onChange: () => void): () => void {
    const bc = channel();
    if (!bc) return () => {};
    bc.onmessage = () => onChange();
    return () => bc.close();
  }
}

/** Keeps alerts for this page load only. */
export class MemoryAlertStore implements AlertStore {
  private rules = new Map<string, AlertRule>();
  private states = new Map<string, AlertState>();
  private events = new Map<string, AlertEvent>();

  constructor(readonly notice: string | null = null) {}

  async listRules() {
    return [...this.rules.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async putRule(rule: AlertRule) {
    this.rules.set(rule.id, rule);
  }
  async deleteRule(id: string) {
    this.rules.delete(id);
    this.states.delete(id);
  }
  async listStates() {
    return [...this.states.values()];
  }
  async listEvents() {
    return [...this.events.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async commit(states: AlertState[], events: AlertEvent[]) {
    for (const s of states) this.states.set(s.ruleId, s);
    const added = events.filter((e) => !this.events.has(e.id));
    for (const e of added) this.events.set(e.id, e);
    const kept = new Set(pruneEvents([...this.events.values()]).map((e) => e.id));
    for (const id of [...this.events.keys()]) if (!kept.has(id)) this.events.delete(id);
    return added;
  }
  async markRead(ids: string[]) {
    for (const id of ids) {
      const e = this.events.get(id);
      if (e) this.events.set(id, { ...e, read: true });
    }
  }
  async deleteEvents(ids: string[]) {
    for (const id of ids) this.events.delete(id);
  }
  subscribe() {
    return () => {};
  }
}

/**
 * IndexedDB when the browser has it; otherwise alerts work for this visit only, and the UI
 * says so. A database from a newer app version is left untouched.
 */
export async function createAlertStore(factory?: IDBFactory): Promise<AlertStore> {
  const idb = factory ?? (typeof indexedDB === "undefined" ? undefined : indexedDB);
  if (!idb) {
    return new MemoryAlertStore("เบราว์เซอร์นี้บันทึกการแจ้งเตือนไม่ได้ กฎจะหายเมื่อปิดแอป");
  }
  try {
    return new IndexedDbAlertStore(await openAlertDb(idb));
  } catch (err) {
    return new MemoryAlertStore(
      err instanceof NewerDatabaseError
        ? "การแจ้งเตือนถูกบันทึกโดย Mallowtick เวอร์ชันที่ใหม่กว่า กรุณาโหลดแอปใหม่ (ข้อมูลเดิมยังอยู่ครบ)"
        : "เปิดที่เก็บการแจ้งเตือนไม่ได้ กฎจะหายเมื่อปิดแอป",
    );
  }
}
