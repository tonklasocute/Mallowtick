import { describe, expect, it } from "vitest";

import { describeFreshness, type FreshnessInput } from "@/lib/freshness";

import { freshness, NOW } from "../fixtures";

const base: FreshnessInput = {
  freshness: freshness(),
  isMarketOpen: true,
  now: NOW,
  online: true,
  receivedAt: NOW.getTime() - 10_000,
  staleAfterMs: 180_000,
};

describe("describeFreshness", () => {
  it("labels declared real-time data as real-time with its provider timestamp", () => {
    const info = describeFreshness(base);
    expect(info).toMatchObject({ kind: "live", label: "Real-time", time: "2:59 PM ET" });
    expect(info.detail).toContain("as of 2:59 PM ET");
  });

  it("never claims real-time unless the latency is declared", () => {
    expect(describeFreshness({ ...base, freshness: freshness({ latency: "delayed" }) }).kind).toBe(
      "delayed",
    );
    expect(
      describeFreshness({ ...base, freshness: freshness({ latency: "unknown" }) }),
    ).toMatchObject({
      kind: "unknown",
      label: "Latency not declared",
    });
  });

  it("marks server fallbacks as stale", () => {
    const info = describeFreshness({ ...base, freshness: freshness({ stale: true }) });
    expect(info.kind).toBe("stale");
    expect(info.detail).toMatch(/Provider unavailable/);
  });

  it("marks data the client has not refreshed as stale", () => {
    const info = describeFreshness({ ...base, receivedAt: NOW.getTime() - 10 * 60_000 });
    expect(info.kind).toBe("stale");
  });

  it("marks everything stale while offline", () => {
    expect(describeFreshness({ ...base, online: false })).toMatchObject({
      kind: "stale",
      label: "Offline",
    });
  });

  it("reports a closed market with the last update time", () => {
    const info = describeFreshness({ ...base, isMarketOpen: false });
    expect(info).toMatchObject({
      kind: "closed",
      label: "Market closed",
      detail: "Last update 2:59 PM ET",
    });
  });

  it("does not invent a timestamp when the provider sent none", () => {
    const info = describeFreshness({ ...base, freshness: freshness({ asOf: null }) });
    expect(info.detail).toContain("update time not reported");
    expect(info.time).toBe("time n/a");
  });
});
