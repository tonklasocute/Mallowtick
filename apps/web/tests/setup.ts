import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
  // Server-side tests (route handlers) run in the node environment, without a window.
  if (typeof window !== "undefined") window.localStorage.clear();
});
