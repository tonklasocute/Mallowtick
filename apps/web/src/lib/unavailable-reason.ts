const LABELS: Record<string, string> = {
  not_found: "Symbol not found",
  rate_limited: "Rate limit reached",
  provider_not_entitled: "Not in data plan",
  provider_auth_failed: "Provider rejected key",
  provider_not_configured: "Provider not configured",
  provider_unavailable: "Provider unavailable",
  timeout: "Provider timed out",
};

/** Short, user-facing explanation for an API reason code. */
export function unavailableReasonLabel(code: string): string {
  return LABELS[code] ?? "Unavailable";
}
