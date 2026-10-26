"use client";

import { useEffect } from "react";

/** Registers /sw.js in production builds only, so development never serves cached assets. */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Installability is a progressive enhancement; the app works without it.
    });
  }, []);
  return null;
}
