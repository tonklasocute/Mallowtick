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

/** Persists the portfolio in this browser's localStorage. Not synced across devices. */
export class LocalStoragePortfolioRepository implements PortfolioRepository {
  readonly storageDescription = "บันทึกไว้ในอุปกรณ์นี้เท่านั้น ไม่ซิงค์ข้ามเครื่อง";

  constructor(private readonly storage: Storage = window.localStorage) {}

  async load(): Promise<Portfolio> {
    try {
      const raw = this.storage.getItem(PORTFOLIO_STORAGE_KEY);
      return raw ? sanitizePortfolio(JSON.parse(raw)) : EMPTY_PORTFOLIO;
    } catch {
      return EMPTY_PORTFOLIO; // corrupted or inaccessible storage: start empty rather than crash
    }
  }

  async save(portfolio: Portfolio): Promise<void> {
    const value = { version: 1, ...sanitizePortfolio(portfolio) };
    this.storage.setItem(PORTFOLIO_STORAGE_KEY, JSON.stringify(value));
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
