"use client";

import { RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StateMessage } from "@/components/ui/state-message";
import { isApiError } from "@/services/api/client";

const COPY: Record<string, { title: string; description: string }> = {
  provider_not_configured: {
    title: "Data provider not configured",
    description:
      "Set TWELVEDATA_API_KEY on the Mallowtick API server to load real market data. No sample prices are shown in the meantime.",
  },
  rate_limited: {
    title: "Taking a short breather",
    description:
      "The market data plan's rate limit was reached. Please try again in about a minute.",
  },
  not_found: {
    title: "No data for this symbol",
    description: "Check the ticker, or search for the company by name.",
  },
  provider_not_entitled: {
    title: "Not included in the data plan",
    description: "The configured market data plan doesn't include this data.",
  },
  provider_auth_failed: {
    title: "Data provider rejected the API key",
    description: "Check TWELVEDATA_API_KEY on the API server.",
  },
  network_error: {
    title: "You seem to be offline",
    description: "Check your connection and try again.",
  },
  api_unreachable: {
    title: "Can't reach the Mallowtick API",
    description: "The API server isn't responding right now.",
  },
};

const FALLBACK = {
  title: "Market data unavailable",
  description: "Something went wrong while loading market data.",
};

export function errorCopy(error: unknown) {
  const code = isApiError(error) ? error.code : "";
  const copy = COPY[code] ?? FALLBACK;
  return { ...copy, code };
}

export function ApiErrorState({
  error,
  onRetry,
  compact,
}: {
  error: unknown;
  onRetry?: () => void;
  compact?: boolean;
}) {
  const { title, description, code } = errorCopy(error);
  return (
    <StateMessage
      tone="error"
      compact={compact}
      title={title}
      description={description}
      action={
        onRetry && code !== "provider_not_configured" ? (
          <Button onClick={onRetry}>
            <RotateCw aria-hidden className="size-4" /> Try again
          </Button>
        ) : undefined
      }
    />
  );
}
