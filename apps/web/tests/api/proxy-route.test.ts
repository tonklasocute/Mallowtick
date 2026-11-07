// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/v1/[...path]/route";

function proxied(headers: Record<string, string>) {
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(Response.json({ data: {} }, { headers: { "Retry-After": "30" } }));
  const req = new NextRequest("http://localhost:3000/api/v1/stocks/AAPL/quote?x=1", { headers });
  return {
    fetchMock,
    res: GET(req, { params: Promise.resolve({ path: ["stocks", "AAPL", "quote"] }) }),
  };
}

describe("API proxy route", () => {
  afterEach(() => vi.restoreAllMocks());

  it("forwards the client's address so the API can limit each client", async () => {
    const { fetchMock, res } = proxied({
      "x-forwarded-for": "203.0.113.7",
      "x-request-id": "abc-123",
    });
    const response = await res;
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("http://localhost:8080/api/v1/stocks/AAPL/quote?x=1");
    const sent = new Headers(init?.headers);
    expect(sent.get("x-forwarded-for")).toBe("203.0.113.7");
    expect(sent.get("x-request-id")).toBe("abc-123");
    expect(response.headers.get("retry-after")).toBe("30");
  });

  it("sends no X-Forwarded-For when there is none", async () => {
    const { fetchMock, res } = proxied({});
    await res;
    expect(new Headers(fetchMock.mock.calls[0]![1]?.headers).has("x-forwarded-for")).toBe(false);
  });
});
