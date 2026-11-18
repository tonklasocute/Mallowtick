import { backUpCorrupt, readVersioned, writeVersioned } from "@/lib/versioned-storage";

import { EMPTY_PORTFOLIO, type Portfolio, sanitizePortfolio } from "./portfolio-model";

/**
 * Storage boundary for the portfolio, like the watchlist's: the UI only talks to this
 * interface, so an account-backed implementation can replace local storage later.
 */
export interface PortfolioRepository {
  /** Human-readable description of where data lives. */
  readonly storageDescription: string;
  load(): Promise<Portfolio>;
  save(portfolio: Portfolio): Promise<void>;
  /** Notifies about changes made elsewhere (e.g. another tab). */
  subscribe(onChange: () => void): () => void;
}

export const PORTFOLIO_STORAGE_KEY = "mallowtick.portfolio.v1";
const VERSION = 1;

/** Persists the portfolio in this browser's localStorage. Not synced across devices. */
export class LocalStoragePortfolioRepository implements PortfolioRepository {
  readonly storageDescription = "บันทึกไว้ในอุปกรณ์นี้เท่านั้น ไม่ซิงค์ข้ามเครื่อง";

  constructor(private readonly storage: Storage = window.localStorage) {}

  async load(): Promise<Portfolio> {
    try {
      const stored = readVersioned(this.storage, PORTFOLIO_STORAGE_KEY, VERSION);
      if (stored.status === "empty") return EMPTY_PORTFOLIO;
      if (stored.status === "corrupt") {
        backUpCorrupt(this.storage, PORTFOLIO_STORAGE_KEY, stored.raw);
        return EMPTY_PORTFOLIO;
      }
      // A newer build's portfolio is shown as far as this build understands it; save refuses it.
      return sanitizePortfolio(stored.value);
    } catch {
      return EMPTY_PORTFOLIO; // inaccessible storage: start empty rather than crash
    }
  }

  /** Throws NewerDataError rather than overwrite a portfolio saved by a newer version. */
  async save(portfolio: Portfolio): Promise<void> {
    const value = { version: VERSION, ...sanitizePortfolio(portfolio) };
    writeVersioned(this.storage, PORTFOLIO_STORAGE_KEY, VERSION, value);
  }

  subscribe(onChange: () => void): () => void {
    const handler = (e: StorageEvent) => {
      if (e.key === PORTFOLIO_STORAGE_KEY) onChange();
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }
}

/** In-memory repository for tests and non-browser environments. */
export class MemoryPortfolioRepository implements PortfolioRepository {
  readonly storageDescription = "เก็บไว้ในหน่วยความจำเฉพาะเซสชันนี้";
  private listeners = new Set<() => void>();

  constructor(private portfolio: Portfolio = EMPTY_PORTFOLIO) {}

  async load(): Promise<Portfolio> {
    return this.portfolio;
  }

  async save(portfolio: Portfolio): Promise<void> {
    this.portfolio = sanitizePortfolio(portfolio);
  }

  subscribe(onChange: () => void): () => void {
    this.listeners.add(onChange);
    return () => this.listeners.delete(onChange);
  }
}
