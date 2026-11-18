/**
 * An absolute http(s) URL, or null. Links from vendors are shown only through this, so a
 * `javascript:` or relative URL in the data can never become a link.
 */
export function safeExternalUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}
