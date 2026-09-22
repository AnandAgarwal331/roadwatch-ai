/**
 * Server-side session handling.
 *
 * The access token lives in an httpOnly, SameSite=Lax cookie. It is never
 * exposed to client JavaScript: the browser talks to `/api/proxy/*`, and only
 * this module reads the cookie to attach the Authorization header. A second
 * httpOnly cookie holds the refresh token, used only by `resolveSession` to
 * mint a new access token when the old one expires. Both cookies expire after
 * the idle timeout (see session-policy.ts) and are extended while the user is
 * active, which is what makes an abandoned session end on its own.
 *
 * A third, non-sensitive cookie carries just the role, so `src/proxy.ts` (not
 * to be confused with the `/api/proxy/*` route above - two unrelated things
 * that happen to share a name since Next.js renamed "middleware" to "proxy")
 * can route without a round-trip. It is a *hint* for navigation only - the
 * backend re-checks the real role on every request, so tampering with it
 * gains nothing.
 *
 * The backend is a Supabase Edge Function now, not FastAPI - it sits behind
 * Supabase's own gateway, which requires a valid `apikey` header (or a valid
 * JWT in `Authorization`) on every request before the function even runs, on
 * top of whatever auth the function code itself does. The publishable key is
 * not a secret (it is designed to be public - the equivalent of the old
 * anon-reachable endpoints), so sending it unconditionally is safe even for
 * a signed-out visitor browsing the public feed.
 */

import "server-only";

import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { cache } from "react";

import { SESSION_COOKIE_MAX_AGE_SECONDS } from "@/lib/session-policy";
import { sharedCache } from "@/lib/ttl-cache";
import type { User, UserRole } from "@/types";

export const SESSION_COOKIE = "rw_session";
export const ROLE_COOKIE = "rw_role";
/** Long-lived credential used only to mint new access tokens. httpOnly, like the access token. */
export const REFRESH_COOKIE = "rw_refresh";

export const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
export const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

/** The Edge Function's own routes are mounted under /api/*, same as FastAPI's used to be. */
export const BACKEND_URL = `${SUPABASE_URL}/functions/v1`;

export interface SessionCookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
}

export function sessionCookieOptions(maxAge: number): SessionCookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge,
  };
}

/** Refresh a little early so a token never expires between the check and its use. */
const EXPIRY_SKEW_SECONDS = 60;

/** The claims of a JWT, or `null` if it cannot be read. Not a signature check. */
function jwtClaims(token: string): Record<string, unknown> | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return claims && typeof claims === "object" ? (claims as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The `exp` claim of a JWT in epoch seconds, or `null` if it cannot be read. */
export function jwtExpiry(token: string): number | null {
  const exp = jwtClaims(token)?.exp;
  return typeof exp === "number" ? exp : null;
}

function isExpiredAt(token: string, skewSeconds: number): boolean {
  const exp = jwtExpiry(token);
  // An unreadable token is passed on as-is; the backend is the real judge.
  return exp !== null && exp - skewSeconds <= Date.now() / 1000;
}

type RefreshResult =
  | { status: "ok"; accessToken: string; refreshToken: string }
  /** The refresh token was rejected: the session is over. */
  | { status: "invalid" }
  /** The auth server could not be reached or is throttling: the session may still be fine. */
  | { status: "unavailable" };

// Concurrent requests (a page load plus its prefetches) often all notice the
// same expired token at once; share one refresh instead of racing several.
const inflightRefreshes = new Map<string, Promise<RefreshResult>>();

async function requestRefresh(refreshToken: string): Promise<RefreshResult> {
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_PUBLISHABLE_KEY },
      body: JSON.stringify({ refresh_token: refreshToken }),
      cache: "no-store",
    });
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      return { status: "invalid" };
    }
    if (!response.ok) return { status: "unavailable" };

    const body = await response.json().catch(() => null);
    if (typeof body?.access_token !== "string" || typeof body?.refresh_token !== "string") {
      return { status: "unavailable" };
    }
    return { status: "ok", accessToken: body.access_token, refreshToken: body.refresh_token };
  } catch {
    return { status: "unavailable" };
  }
}

function refreshTokens(refreshToken: string): Promise<RefreshResult> {
  const existing = inflightRefreshes.get(refreshToken);
  if (existing) return existing;
  const pending = requestRefresh(refreshToken).finally(() => inflightRefreshes.delete(refreshToken));
  inflightRefreshes.set(refreshToken, pending);
  return pending;
}

export type SessionCheck =
  /** Nobody is signed in. */
  | { state: "none" }
  /** The access token is usable as it is. */
  | { state: "valid"; accessToken: string; refreshToken: string | null }
  /** The access token was expired and has been replaced; the cookies need rewriting. */
  | { state: "renewed"; accessToken: string; refreshToken: string }
  /** The session is finished and its cookies should be cleared. */
  | { state: "expired" }
  /** The token could not be renewed right now; carry on with what there is and try again later. */
  | { state: "unavailable"; accessToken: string | null };

/**
 * Works out what the session cookies amount to right now, renewing the access
 * token from the refresh token when it has expired or is about to.
 *
 * Every entry point that reads the session (the route guard, the API proxy,
 * the keep-alive endpoint) goes through this, so the rules live in one place.
 */
export async function resolveSession(
  accessToken: string | undefined,
  refreshToken: string | undefined,
): Promise<SessionCheck> {
  if (!accessToken && !refreshToken) return { state: "none" };

  if (accessToken && !isExpiredAt(accessToken, EXPIRY_SKEW_SECONDS)) {
    return { state: "valid", accessToken, refreshToken: refreshToken ?? null };
  }

  if (!refreshToken) {
    // No way to renew. A token in its last minute still works; anything older does not.
    return accessToken && !isExpiredAt(accessToken, 0)
      ? { state: "valid", accessToken, refreshToken: null }
      : { state: "expired" };
  }

  const result = await refreshTokens(refreshToken);
  if (result.status === "ok") {
    return { state: "renewed", accessToken: result.accessToken, refreshToken: result.refreshToken };
  }
  if (result.status === "invalid") return { state: "expired" };
  return { state: "unavailable", accessToken: accessToken ?? null };
}

/**
 * Writes the session cookies with a fresh idle-timeout lifetime.
 *
 * `role` is optional because not every caller knows it (a token refresh does
 * not return the profile); omit it and the existing role cookie is left as is.
 */
export function setSessionCookies(
  response: NextResponse,
  tokens: { accessToken: string; refreshToken?: string | null; role?: string },
): void {
  const options = sessionCookieOptions(SESSION_COOKIE_MAX_AGE_SECONDS);
  response.cookies.set(SESSION_COOKIE, tokens.accessToken, options);
  if (tokens.refreshToken) response.cookies.set(REFRESH_COOKIE, tokens.refreshToken, options);
  if (tokens.role) {
    // Readable by the proxy for routing. Never trusted for authorisation.
    response.cookies.set(ROLE_COOKIE, tokens.role, { ...options, httpOnly: false });
  }
}

export function clearSessionCookies(response: NextResponse): void {
  // maxAge 0 clears rather than merely expiring on the client's clock.
  const options = sessionCookieOptions(0);
  response.cookies.set(SESSION_COOKIE, "", options);
  response.cookies.set(REFRESH_COOKIE, "", options);
  response.cookies.set(ROLE_COOKIE, "", { ...options, httpOnly: false });
}

export async function getSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

export async function getRoleHint(): Promise<UserRole | null> {
  const store = await cookies();
  const value = store.get(ROLE_COOKIE)?.value;
  return value === "CITIZEN" || value === "ADMIN" || value === "REPAIR_TEAM" ? value : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The profile row for the user a token belongs to, or `null` if it cannot be
 * loaded (bad or expired token, no such row, database unreachable).
 *
 * Read straight from Supabase's database API instead of through the Edge
 * Function's `/auth/me`. It is the same row - the token's own, under the same
 * Row Level Security - but the Edge Function costs a cold start plus two
 * further round trips (verify the token, then read the row) and this is one
 * request that answers in a fraction of the time. Every page render and every
 * sign-in goes through here, so that is most of what "the site feels fast"
 * comes down to.
 *
 * The id comes from the token's own `sub` claim, which is only *read* here;
 * the database verifies the signature before answering, so a forged token gets
 * a 401 and a valid one can only ever be asked about itself.
 */
export async function fetchProfile(token: string): Promise<User | null> {
  const sub = jwtClaims(token)?.sub;
  if (typeof sub !== "string" || !UUID.test(sub)) return null;

  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?select=*&id=eq.${encodeURIComponent(sub)}`,
      {
        headers: {
          apikey: SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${token}`,
          // One object rather than an array; 406 when there is no such row.
          Accept: "application/vnd.pgrst.object+json",
        },
        // Session state must never be served from a cache.
        cache: "no-store",
      },
    );
    if (!response.ok) return null;
    return (await response.json()) as User;
  } catch {
    return null;
  }
}

/**
 * Profiles by access token, for a few seconds.
 *
 * Even the direct database read costs a network round trip, and a full page
 * load asks for the user on its way in, so without this every navigation pays
 * it. The token is the key, so a new sign-in or a refreshed token simply
 * starts fresh, and nothing outlives the token it belongs to for long.
 *
 * The price is that a role change or deactivation can take up to this long to
 * show up in what pages *render* - never in what the backend allows, which is
 * checked against the database on every request. Edits the user makes to their
 * own profile clear their entry (see the API proxy), so those show at once.
 */
const PROFILE_CACHE_MS = 30_000;
const profiles = sharedCache<User>("profiles", { maxEntries: 500, freshMs: PROFILE_CACHE_MS, staleMs: 0 });

/** Records a profile just loaded elsewhere (sign-in already has it) so the next page need not fetch it again. */
export function rememberProfile(token: string, user: User): void {
  profiles.set(token, user);
}

export function forgetProfile(token: string): void {
  profiles.delete(token);
}

/**
 * The signed-in user, or `null` when nobody is signed in, the session has
 * expired, or the account has been deactivated.
 *
 * `cache()` makes this run once per request however many layouts and pages ask
 * for it - the header, a console layout and the page itself all do.
 *
 * This checks the token's signature and expiry (via the database) but does not
 * ask the auth server whether the session was revoked. That is deliberate for
 * deciding what to *render*; the Edge Function still does the full check, and
 * re-reads the role, on every request that actually reads or changes data.
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const token = await getSessionToken();
  if (!token) return null;

  let user = profiles.get(token)?.value ?? null;
  if (!user) {
    user = await fetchProfile(token);
    if (user) profiles.set(token, user);
  }
  return user?.is_active ? user : null;
});

// Public figures (the landing page's totals) are the same for every visitor and
// only need to be roughly current, so they are served from memory - instantly,
// even when the Edge Function behind them is cold - and refreshed in the
// background rather than making anyone wait for it.
const publicData = sharedCache<unknown>("public-data", {
  maxEntries: 50,
  freshMs: 60_000,
  staleMs: 5 * 60_000,
});

/** Like `serverFetch` for data that is identical for everyone, with no session attached, and cached briefly. */
export async function publicFetch<T>(path: string): Promise<T | null> {
  try {
    const { value } = await publicData.getOrLoad(path, async () => {
      const response = await fetch(`${BACKEND_URL}${path}`, {
        headers: { apikey: SUPABASE_PUBLISHABLE_KEY },
        cache: "no-store",
      });
      // Thrown, not returned, so a failure is never stored as if it were data.
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as unknown;
    });
    return value as T;
  } catch {
    return null;
  }
}

/** Server-side fetch against the backend, carrying the session token. */
export async function serverFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T | null> {
  const token = await getSessionToken();

  try {
    const response = await fetch(`${BACKEND_URL}${path}`, {
      ...init,
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
      cache: "no-store",
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}
