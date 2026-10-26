import { sanitizeSymbols } from "./watchlist-model";

/**
 * Storage boundary for the watchlist. The UI only talks to this interface, so
 * an account-backed implementation can replace local storage later.
 */
export interface WatchlistRepository {
  /** Human-readable description of where data lives, shown in Settings. */
  readonly storageDescription: string;
  list(): Promise<string[]>;
  save(symbols: string[]): Promise<void>;
  /** Notifies about changes made elsewhere (e.g. another tab). */
  subscribe(onChange: () => void): () => void;
}

export const STORAGE_KEY = "mallowtick.watchlist.v1";

interface StoredWatchlist {
  version: 1;
  symbols: string[];
}

/** Persists the watchlist in this browser's localStorage. Not synced across devices. */
export class LocalStorageWatchlistRepository implements WatchlistRepository {
  readonly storageDescription =
    "บันทึกไว้ในอุปกรณ์นี้เท่านั้น (พื้นที่จัดเก็บของเบราว์เซอร์) ไม่ซิงค์ข้ามอุปกรณ์";

  constructor(private readonly storage: Storage = window.localStorage) {}

  async list(): Promise<string[]> {
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as Partial<StoredWatchlist>;
      return sanitizeSymbols(parsed?.symbols);
    } catch {
      return []; // corrupted or inaccessible storage: start empty rather than crash
    }
  }

  async save(symbols: string[]): Promise<void> {
    const value: StoredWatchlist = { version: 1, symbols: sanitizeSymbols(symbols) };
    this.storage.setItem(STORAGE_KEY, JSON.stringify(value));
  }

  subscribe(onChange: () => void): () => void {
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) onChange();
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }
}

/** In-memory repository for tests and non-browser environments. */
export class MemoryWatchlistRepository implements WatchlistRepository {
  readonly storageDescription = "เก็บไว้ในหน่วยความจำเฉพาะเซสชันนี้";
  private listeners = new Set<() => void>();

  constructor(private symbols: string[] = []) {}

  async list(): Promise<string[]> {
    return [...this.symbols];
  }

  async save(symbols: string[]): Promise<void> {
    this.symbols = sanitizeSymbols(symbols);
  }

  subscribe(onChange: () => void): () => void {
    this.listeners.add(onChange);
    return () => this.listeners.delete(onChange);
  }
}
