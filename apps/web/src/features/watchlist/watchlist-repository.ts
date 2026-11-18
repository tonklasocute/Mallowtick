import { backUpCorrupt, readVersioned, writeVersioned } from "@/lib/versioned-storage";

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
const VERSION = 1;

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
      const stored = readVersioned(this.storage, STORAGE_KEY, VERSION);
      if (stored.status === "empty") return [];
      if (stored.status === "corrupt") {
        backUpCorrupt(this.storage, STORAGE_KEY, stored.raw);
        return [];
      }
      // A newer build's list is shown as far as this build understands it; save refuses it.
      return sanitizeSymbols(stored.value.symbols);
    } catch {
      return []; // inaccessible storage: start empty rather than crash
    }
  }

  /** Throws NewerDataError rather than overwrite a list saved by a newer version. */
  async save(symbols: string[]): Promise<void> {
    const value: StoredWatchlist = { version: VERSION, symbols: sanitizeSymbols(symbols) };
    writeVersioned(this.storage, STORAGE_KEY, VERSION, value);
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
