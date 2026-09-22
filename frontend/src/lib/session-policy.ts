/**
 * How long a signed-in session survives, shared by the browser and the server.
 *
 * Deliberately free of `server-only` so the client-side idle timer and the
 * server-side cookie lifetimes are derived from the same numbers and cannot
 * drift apart.
 */

/** A signed-in user is signed out after this long without interacting. */
export const IDLE_TIMEOUT_MS = 30 * 60_000;

/**
 * While the user is active the browser pings the server this often, which
 * renews the access token if needed and slides the cookies' expiry forward.
 */
export const KEEPALIVE_INTERVAL_MS = 10 * 60_000;

/**
 * Session cookies expire this long after the last keep-alive - the idle
 * timeout plus a grace period, so the browser's own timer (which shows the
 * "you were signed out" notice) fires before the cookie silently vanishes.
 * This is also what enforces the idle limit when the tab was simply closed.
 */
export const SESSION_COOKIE_MAX_AGE_SECONDS = Math.round((IDLE_TIMEOUT_MS + 5 * 60_000) / 1000);
