/**
 * Guards for user data kept as versioned JSON in localStorage. A value written
 * by a newer build of the app, or one that no longer parses, must never be
 * overwritten by this build: the user would lose data silently.
 */

/** What a stored value turned out to be. */
export type StoredValue =
  | { status: "empty" }
  | { status: "ok"; value: Record<string, unknown> }
  /** Written by a newer build; readable at best, never to be written over. */
  | { status: "newer"; version: number; value: Record<string, unknown> }
  /** Not JSON, or not an object: kept aside under backupKey before any write. */
  | { status: "corrupt"; raw: string };

/** Where an unreadable value is copied before it can be written over. */
export const backupKey = (key: string) => `${key}.backup`;

/** Thrown by a save that would overwrite data from a newer version of the app. */
export class NewerDataError extends Error {
  constructor() {
    super(
      "ข้อมูลนี้ถูกบันทึกโดย Mallowtick เวอร์ชันที่ใหม่กว่า จึงยังแก้ไขไม่ได้ กรุณาโหลดแอปใหม่เพื่ออัปเดต",
    );
    this.name = "NewerDataError";
  }
}

/**
 * Reads key and classifies it against the version this build writes. A value
 * without a numeric version counts as the current one, as v1 data always had one.
 */
export function readVersioned(storage: Storage, key: string, version: number): StoredValue {
  const raw = storage.getItem(key);
  if (raw === null) return { status: "empty" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "corrupt", raw };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { status: "corrupt", raw };
  }
  const value = parsed as Record<string, unknown>;
  const v = value.version;
  if (typeof v === "number" && Number.isInteger(v) && v > version) {
    return { status: "newer", version: v, value };
  }
  return { status: "ok", value };
}

/**
 * Copies an unreadable value to backupKey once, so a later save can't lose it.
 * An existing backup is kept: the first broken value is the one worth saving.
 */
export function backUpCorrupt(storage: Storage, key: string, raw: string): void {
  try {
    if (storage.getItem(backupKey(key)) === null) storage.setItem(backupKey(key), raw);
  } catch {
    // Storage full or blocked: nothing more can be done without losing the value.
  }
}

/**
 * Writes value under key unless what is stored there now came from a newer build
 * (checked again here: another tab may run a newer version). A corrupt value is
 * backed up first.
 */
export function writeVersioned(
  storage: Storage,
  key: string,
  version: number,
  value: object,
): void {
  const current = readVersioned(storage, key, version);
  if (current.status === "newer") throw new NewerDataError();
  if (current.status === "corrupt") backUpCorrupt(storage, key, current.raw);
  storage.setItem(key, JSON.stringify(value));
}
