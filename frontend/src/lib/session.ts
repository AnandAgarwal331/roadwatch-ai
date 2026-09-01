/**
 * Server-side session handling.
 *
 * The access token lives in an httpOnly, SameSite=Lax cookie. It is never
 * exposed to client JavaScript: the browser talks to `/api/proxy/*`, and only
 * this module reads the cookie to attach the Authorization header.
 *
 * A second, non-sensitive cookie carries just the role, so middleware can route
 * without a round-trip. It is a *hint* for navigation only - the backend
 * re-checks the real role on every request, so tampering with it gains nothing.
 */

import "server-only";

import { cookies } from "next/headers";

import type { User, UserRole } from "@/types";

export const SESSION_COOKIE = "rw_session";
export const ROLE_COOKIE = "rw_role";

export const BACKEND_URL =
  process.env.BACKEND_INTERNAL_URL?.replace(/\/$/, "") ?? "http://localhost:8000";

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

export async function getSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

export async function getRoleHint(): Promise<UserRole | null> {
  const store = await cookies();
  const value = store.get(ROLE_COOKIE)?.value;
  return value === "CITIZEN" || value === "ADMIN" || value === "REPAIR_TEAM" ? value : null;
}

/**
 * The signed-in user, verified against the backend.
 *
 * Returns `null` rather than throwing when the session is missing or expired,
 * so layouts can redirect instead of rendering an error.
 */
export async function getCurrentUser(): Promise<User | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    const response = await fetch(`${BACKEND_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      // Session state must never be served from a cache.
      cache: "no-store",
    });
    if (!response.ok) return null;
    return (await response.json()) as User;
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
