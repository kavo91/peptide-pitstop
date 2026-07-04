/**
 * Secure-context-safe UUID v4.
 *
 * `crypto.randomUUID()` is only defined in a SECURE CONTEXT (HTTPS or
 * localhost). Self-hosters commonly reach the app over plain HTTP on a LAN IP
 * (e.g. http://tower:3009), where `crypto.randomUUID` is `undefined` and
 * calling it throws — which previously wedged the dose-log button on
 * "Logging…" forever (the throw happened before the busy flag was cleared).
 *
 * `crypto.getRandomValues()` IS available in non-secure contexts, so we build a
 * v4 UUID from it. A final Math.random() fallback covers exotic environments
 * with no Web Crypto at all (never expected in a browser, but keeps this total).
 *
 * Only used for client-side idempotency keys (the dose-log `clientUuid`), so a
 * non-CSPRNG fallback is acceptable — collisions, not secrecy, are the only
 * concern, and getRandomValues covers every real browser.
 */
export function safeUuid(): string {
  const c: Crypto | undefined = globalThis.crypto;

  if (c?.randomUUID) return c.randomUUID();

  if (c?.getRandomValues) {
    const b = c.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; // version 4
    b[8] = (b[8] & 0x3f) | 0x80; // variant 10
    const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0"));
    return (
      hex.slice(0, 4).join("") +
      "-" +
      hex.slice(4, 6).join("") +
      "-" +
      hex.slice(6, 8).join("") +
      "-" +
      hex.slice(8, 10).join("") +
      "-" +
      hex.slice(10, 16).join("")
    );
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
