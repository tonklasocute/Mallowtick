import type { NextRequest } from "next/server";

// Proxies /api/v1/* to the Go API so the browser stays on one origin and the
// API location is runtime configuration rather than a public build variable.
const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:8080";
const UPSTREAM_TIMEOUT_MS = 20_000;
const FORWARDED_HEADERS = ["retry-after", "x-request-id"];

export const dynamic = "force-dynamic";

function errorResponse(status: number, code: string, message: string) {
  return Response.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  if (path.some((seg) => seg === "." || seg === ".." || seg === "")) {
    return errorResponse(400, "invalid_request", "Invalid API path.");
  }
  const target = new URL(`/api/v1/${path.map(encodeURIComponent).join("/")}`, API_ORIGIN);
  target.search = req.nextUrl.search;

  const headers = new Headers({ Accept: "application/json" });
  const requestId = req.headers.get("x-request-id");
  if (requestId) headers.set("X-Request-ID", requestId);

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      headers,
      cache: "no-store",
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
    });
  } catch {
    return errorResponse(502, "api_unreachable", "The Mallowtick API server could not be reached.");
  }

  const out = new Headers({
    "Content-Type": upstream.headers.get("content-type") ?? "application/json",
    "Cache-Control": "no-store",
  });
  for (const h of FORWARDED_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  return new Response(await upstream.text(), { status: upstream.status, headers: out });
}
