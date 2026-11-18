import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { type AlertEvent, initialState, newRule } from "@/features/alerts/alert-model";
import {
  createAlertStore,
  DB_NAME,
  DB_VERSION,
  IndexedDbAlertStore,
  MemoryAlertStore,
  openAlertDb,
} from "@/features/alerts/alert-store";

const NOW = new Date("2026-10-23T19:00:00Z");

function event(id: string, minutes = 0, read = false): AlertEvent {
  return {
    id,
    ruleId: "r1",
    symbol: "AAPL",
    type: "price_above",
    title: "AAPL ราคาสูงกว่า $200.00",
    message: "",
    facts: [{ label: "ราคา", value: "$201.00" }],
    source: "Finnhub",
    dataAsOf: NOW.toISOString(),
    createdAt: new Date(NOW.getTime() + minutes * 60_000).toISOString(),
    read,
    marketOpen: true,
    url: null,
  };
}

describe("IndexedDbAlertStore", () => {
  it("keeps rules, states and alerts across reopening the database", async () => {
    const factory = new IDBFactory();
    const store = (await createAlertStore(factory)) as IndexedDbAlertStore;
    expect(store).toBeInstanceOf(IndexedDbAlertStore);
    const rule = newRule({ symbol: "AAPL", type: "price_above", threshold: 200 }, NOW, "r1");
    await store.putRule(rule);
    const state = { ...initialState("r1"), lastValue: 201, conditionMet: true };
    expect(await store.commit([state], [event("e1")])).toHaveLength(1);

    const reopened = await createAlertStore(factory);
    expect(await reopened.listRules()).toEqual([rule]);
    expect(await reopened.listStates()).toEqual([state]);
    expect((await reopened.listEvents()).map((e) => e.id)).toEqual(["e1"]);
  });

  it("stores an alert raised twice (e.g. by two tabs) once, keeping its read state", async () => {
    const store = await createAlertStore(new IDBFactory());
    await store.commit([], [event("e1")]);
    await store.markRead(["e1"]);
    expect(await store.commit([], [event("e1")])).toEqual([]);
    expect((await store.listEvents())[0]?.read).toBe(true);
  });

  it("deletes a rule with its state but keeps its alerts", async () => {
    const store = await createAlertStore(new IDBFactory());
    await store.putRule(
      newRule({ symbol: "AAPL", type: "price_above", threshold: 200 }, NOW, "r1"),
    );
    await store.commit([initialState("r1")], [event("e1")]);
    await store.deleteRule("r1");
    expect(await store.listRules()).toEqual([]);
    expect(await store.listStates()).toEqual([]);
    expect(await store.listEvents()).toHaveLength(1);
    await store.deleteEvents(["e1"]);
    expect(await store.listEvents()).toEqual([]);
  });

  it("drops malformed records on read instead of guessing them", async () => {
    const factory = new IDBFactory();
    const db = await openAlertDb(factory);
    const tx = db.transaction(["alertRules", "alertEvents"], "readwrite");
    tx.objectStore("alertRules").put({ id: "broken", symbol: "AAPL", type: "nonsense" });
    tx.objectStore("alertEvents").put({ id: "half" });
    await new Promise((r) => (tx.oncomplete = r));
    const store = new IndexedDbAlertStore(db);
    expect(await store.listRules()).toEqual([]);
    expect(await store.listEvents()).toEqual([]);
  });

  it("creates its schema idempotently and records the version", async () => {
    const factory = new IDBFactory();
    (await openAlertDb(factory)).close();
    const db = await openAlertDb(factory);
    expect([...db.objectStoreNames].sort()).toEqual([
      "alertEvents",
      "alertRules",
      "alertState",
      "meta",
    ]);
    const meta = await new Promise((resolve) => {
      const r = db.transaction("meta").objectStore("meta").get("schema");
      r.onsuccess = () => resolve(r.result);
    });
    expect(meta).toEqual({ key: "schema", version: DB_VERSION });
  });

  it("leaves a newer version's database alone and works in memory instead", async () => {
    const factory = new IDBFactory();
    await new Promise<void>((resolve) => {
      const r = factory.open(DB_NAME, DB_VERSION + 1);
      r.onupgradeneeded = () => r.result.createObjectStore("future", { keyPath: "id" });
      r.onsuccess = () => {
        const tx = r.result.transaction("future", "readwrite");
        tx.objectStore("future").put({ id: "keep-me" });
        tx.oncomplete = () => {
          r.result.close();
          resolve();
        };
      };
    });
    const store = await createAlertStore(factory);
    expect(store).toBeInstanceOf(MemoryAlertStore);
    expect(store.notice).toMatch(/เวอร์ชันที่ใหม่กว่า/);
    const kept = await new Promise((resolve) => {
      const r = factory.open(DB_NAME);
      r.onsuccess = () => {
        const g = r.result.transaction("future").objectStore("future").get("keep-me");
        g.onsuccess = () => resolve(g.result);
      };
    });
    expect(kept).toEqual({ id: "keep-me" });
  });
});

describe("MemoryAlertStore", () => {
  it("behaves like the IndexedDB store", async () => {
    const store = new MemoryAlertStore("แจ้งเตือน");
    await store.commit([], [event("e1", 0), event("e2", 1)]);
    expect(await store.commit([], [event("e1", 0)])).toEqual([]);
    await store.markRead(["e2"]);
    expect((await store.listEvents()).map((e) => [e.id, e.read])).toEqual([
      ["e2", true],
      ["e1", false],
    ]);
  });

  it("is what the app uses without IndexedDB", async () => {
    const store = await createAlertStore(undefined as unknown as IDBFactory);
    // jsdom has no indexedDB global.
    expect(store).toBeInstanceOf(MemoryAlertStore);
    expect(store.notice).toMatch(/บันทึกการแจ้งเตือนไม่ได้/);
  });
});
