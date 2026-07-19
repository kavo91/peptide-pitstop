/**
 * The cookie name the client mirrors its IANA timezone into. Isolated in its
 * own module (no "server-only", no Intl logic) so BOTH the client watchdog
 * (ActiveRefresh) and the server reader (viewer-tz.ts) can import it without
 * dragging server-only or client-only code across the boundary.
 */
export const TZ_COOKIE = "pt_tz";
