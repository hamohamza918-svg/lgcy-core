/**
 * Secret redaction. Defends against a token (or any credential-shaped value)
 * leaking into logs, diagnostics, exports, or error responses.
 */

// A Discord bot token is three base64url-ish segments separated by dots.
const TOKEN_RE = /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{20,}\b/g;

// Keys whose values must always be masked, regardless of shape.
const SECRET_KEYS = /(token|secret|password|passwd|authorization|apikey|api_key|encryptionkey|privatekey|credential)/i;

export const REDACTED = '«redacted»';

/** Masks token-shaped substrings inside a string. */
export function redactString(input: string): string {
  return input.replace(TOKEN_RE, REDACTED);
}

/**
 * Deep-redacts an object: any property whose key looks secret is replaced with
 * «redacted», and any token-shaped string value anywhere is masked. Returns a
 * new structure; the input is not mutated.
 */
export function redactDeep<T>(value: T): T {
  if (typeof value === 'string') return redactString(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.test(k) ? REDACTED : redactDeep(v);
    }
    return out as unknown as T;
  }
  return value;
}
