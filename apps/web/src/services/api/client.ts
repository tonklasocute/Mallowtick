import type { ApiErrorCode } from "@/types/api";

/** Same-origin prefix; the Next.js route handler proxies it to the Go API. */
export const API_BASE = "/api/v1";

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly status: number,
    readonly retryAfterSeconds?: number,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

type Params = Record<string, string | undefined>;

interface RequestOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

function buildUrl(path: string, params?: Params): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== "") search.set(k, v);
  }
  const qs = search.toString();
  return `${API_BASE}${path}${qs ? `?${qs}` : ""}`;
}

/**
 * GETs an API path and unwraps the `{ data }` envelope. Failures are always
 * thrown as ApiError, except aborts, which are rethrown unchanged.
 */
export async function apiGet<T>(
  path: string,
  params?: Params,
  opts: RequestOptions = {},
): Promise<T> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(buildUrl(path, params), {
      signal: opts.signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError("network_error", "Can't reach Mallowtick. Check your connection.", 0);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiError("bad_response", "The server sent an unexpected response.", res.status);
  }

  const envelope = (body ?? {}) as {
    data?: T;
    error?: { code?: string; message?: string; requestId?: string };
  };
  if (!res.ok || envelope.error) {
    const retryAfter = Number(res.headers.get("Retry-After"));
    throw new ApiError(
      (envelope.error?.code as ApiErrorCode | undefined) ?? "internal_error",
      envelope.error?.message ?? `Request failed (${res.status}).`,
      res.status,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
      envelope.error?.requestId,
    );
  }
  if (envelope.data === undefined || envelope.data === null) {
    throw new ApiError("bad_response", "The server sent an empty response.", res.status);
  }
  return envelope.data;
}
