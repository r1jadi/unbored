/**
 * Where to send someone after they sign in.
 *
 * The destination arrives in the URL (`?redirect=`, `?next=`), so anyone can put
 * anything there and mail the link to a player. It is only ever honoured when it
 * is a path inside this app; everything else becomes the home page.
 *
 * "Starts with one slash" is not enough to mean that. A browser reads `/\host`
 * like `//host` — another site — and drops tabs and newlines from a URL before
 * reading it, so `/<tab>/host` is the same trick. The value is therefore checked
 * the way a browser would resolve it: against a placeholder origin, it must stay
 * on that origin.
 */

const PLACEHOLDER_ORIGIN = "https://app.invalid";

/** Longer than any real route; a longer value is a mistake or an attack. */
const MAX_LENGTH = 2048;

// Characters a browser strips or treats as a slash: C0 controls (incl. tab, CR,
// LF), DEL and the backslash.
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u001f\u007f\\]/;

/** `true` for a path, query and fragment that stay inside this app. */
export function isSafeNext(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_LENGTH) return false;
  if (!value.startsWith("/") || value.startsWith("//")) return false;
  if (UNSAFE.test(value)) return false;
  try {
    return new URL(value, PLACEHOLDER_ORIGIN).origin === PLACEHOLDER_ORIGIN;
  } catch {
    return false;
  }
}

/** The destination when it is safe, otherwise the home page. */
export function sanitizeNext(value: unknown): string {
  return isSafeNext(value) ? value : "/";
}
