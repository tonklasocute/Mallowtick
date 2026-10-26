import { describe, expect, it, vi } from "vitest";

import { ApiError, apiGet } from "@/services/api/client";

import { apiError, ok } from "../fixtures";

describe("apiGet", () => {
  it("unwraps the data envelope and builds the URL", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok({ value: 1 }));
    await expect(
      apiGet("/stocks/search", { q: "apple", empty: "", skip: undefined }, { fetchImpl }),
    ).resolves.toEqual({ value: 1 });
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/v1/stocks/search?q=apple",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("maps error envelopes to ApiError with code, status and Retry-After", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(apiError(429, "rate_limited", "slow down", { "Retry-After": "60" }));
    const err = await apiGet("/x", undefined, { fetchImpl }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      code: "rate_limited",
      status: 429,
      retryAfterSeconds: 60,
      requestId: "req-1",
      message: "slow down",
    });
  });

  it("reports provider-not-configured distinctly", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(apiError(503, "provider_not_configured"));
    await expect(apiGet("/x", undefined, { fetchImpl })).rejects.toMatchObject({
      code: "provider_not_configured",
    });
  });

  it("treats network failures as network_error", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(apiGet("/x", undefined, { fetchImpl })).rejects.toMatchObject({
      code: "network_error",
      status: 0,
    });
  });

  it("rethrows aborts unchanged", async () => {
    const abort = new DOMException("aborted", "AbortError");
    const fetchImpl = vi.fn().mockRejectedValue(abort);
    await expect(apiGet("/x", undefined, { fetchImpl })).rejects.toBe(abort);
  });

  it("rejects non-JSON and empty responses", async () => {
    const html = vi.fn().mockResolvedValue(new Response("<html>", { status: 502 }));
    await expect(apiGet("/x", undefined, { fetchImpl: html })).rejects.toMatchObject({
      code: "bad_response",
      status: 502,
    });
    const empty = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ data: null }), { status: 200 }));
    await expect(apiGet("/x", undefined, { fetchImpl: empty })).rejects.toMatchObject({
      code: "bad_response",
    });
  });

  it("uses a generic code when an error body is missing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 500 }));
    await expect(apiGet("/x", undefined, { fetchImpl })).rejects.toMatchObject({
      code: "internal_error",
      status: 500,
    });
  });
});
