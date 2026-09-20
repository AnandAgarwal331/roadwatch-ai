/**
 * Session endpoints: login, register, logout.
 *
 * Kept separate from the generic proxy because these are the only routes that
 * touch cookies. On success the Supabase session's access token is written
 * into an httpOnly cookie and stripped from the response body, so it never
 * reaches client JavaScript.
 *
 * Login and register talk to Supabase Auth (GoTrue) directly rather than
 * through the Edge Function - they *are* what Supabase Auth already is, so a
 * wrapper endpoint on the backend would just be a slower detour to the same
 * place. The profile (role, full_name, phone - the shape the rest of this
 * app expects as `User`) is a separate concept GoTrue doesn't carry, fetched
 * afterwards from the Edge Function's already-ported `/auth/me`.
 */

import { NextRequest, NextResponse } from "next/server";

import {
  BACKEND_URL,
  getSessionToken,
  ROLE_COOKIE,
  SESSION_COOKIE,
  sessionCookieOptions,
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
} from "@/lib/session";
import { passwordProblem } from "@/lib/password-rules";
import type { User } from "@/types";

const ACTIONS = { login: "/auth/v1/token?grant_type=password", register: "/auth/v1/signup" } as const;

type Action = keyof typeof ACTIONS;

function isAction(value: string): value is Action {
  return value in ACTIONS;
}

function unreachableResponse() {
  return NextResponse.json(
    {
      error: {
        code: "backend_unreachable",
        message: "The RoadWatch service is not responding. Please try again in a moment.",
      },
    },
    { status: 503 },
  );
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ action: string }> },
) {
  const { action } = await context.params;

  if (action === "logout") {
    const token = await getSessionToken();
    if (token) {
      // Best-effort server-side session revocation; a failure here must
      // never block the client-side cookie clear the user is waiting on.
      fetch(`${SUPABASE_URL}/auth/v1/logout`, {
        method: "POST",
        headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` },
        cache: "no-store",
      }).catch(() => {});
    }

    const response = NextResponse.json({ message: "Signed out." });
    // maxAge 0 clears rather than merely expiring on the client's clock.
    response.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(0) });
    response.cookies.set(ROLE_COOKIE, "", {
      ...sessionCookieOptions(0),
      httpOnly: false,
    });
    return response;
  }

  if (action === "forgot") {
    const payload = await request.json().catch(() => null);
    const email = typeof payload?.email === "string" ? payload.email.trim() : "";
    if (!email) {
      return NextResponse.json(
        { error: { code: "validation_error", message: "Enter your email address." } },
        { status: 422 },
      );
    }

    try {
      // The link in the email lands on /reset-password; that address must also
      // be on the Supabase project's allowed redirect list.
      const redirectTo = encodeURIComponent(`${request.nextUrl.origin}/reset-password`);
      const response = await fetch(`${SUPABASE_URL}/auth/v1/recover?redirect_to=${redirectTo}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_PUBLISHABLE_KEY },
        body: JSON.stringify({ email }),
        cache: "no-store",
      });
      if (!response.ok) console.error(`password recovery request failed: HTTP ${response.status}`);
    } catch {
      return unreachableResponse();
    }

    // Identical answer whether or not the address has an account, so this
    // form cannot be used to find out who is registered.
    return NextResponse.json({
      message: "If an account exists for that email, a reset link is on its way.",
    });
  }

  if (action === "reset") {
    const payload = await request.json().catch(() => null);
    const accessToken = typeof payload?.access_token === "string" ? payload.access_token : "";
    const password = typeof payload?.password === "string" ? payload.password : "";
    const problem = passwordProblem(password);
    if (!accessToken || problem) {
      return NextResponse.json(
        { error: { code: "validation_error", message: problem ?? "This reset link is not valid." } },
        { status: 422 },
      );
    }

    let response: Response;
    try {
      response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ password }),
        cache: "no-store",
      });
    } catch {
      return unreachableResponse();
    }

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const expired = response.status === 401 || response.status === 403;
      return NextResponse.json(
        {
          error: {
            code: expired ? "link_expired" : "auth_failed",
            message: expired
              ? "This reset link has expired or was already used. Request a new one."
              : (body?.msg ?? body?.message ?? "Could not update your password. Please try again."),
          },
        },
        { status: expired ? 401 : response.status },
      );
    }

    return NextResponse.json({ message: "Your password has been updated. You can sign in now." });
  }

  if (!isAction(action)) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Unknown action." } },
      { status: 404 },
    );
  }

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload.email !== "string" || typeof payload.password !== "string") {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Email and password are required." } },
      { status: 422 },
    );
  }

  const body =
    action === "register"
      ? {
          email: payload.email,
          password: payload.password,
          // Read by the handle_new_user() trigger to seed profiles.full_name;
          // phone has no equivalent trigger field, set via /auth/me below.
          data: { full_name: payload.full_name },
        }
      : { email: payload.email, password: payload.password };

  let authResponse: Response;
  try {
    authResponse = await fetch(`${SUPABASE_URL}${ACTIONS[action]}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_PUBLISHABLE_KEY },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    return unreachableResponse();
  }

  const authBody = await authResponse.json().catch(() => null);

  if (!authResponse.ok || !authBody?.access_token) {
    const message =
      authBody?.msg ?? authBody?.error_description ?? "Could not sign you in. Please try again.";
    return NextResponse.json(
      { error: { code: "auth_failed", message } },
      { status: authResponse.status || 500 },
    );
  }

  const accessToken = authBody.access_token as string;
  const expiresIn = (authBody.expires_in as number | undefined) ?? 43200;

  if (action === "register" && typeof payload.phone === "string" && payload.phone.trim()) {
    // Best-effort - a failure here shouldn't fail the whole registration;
    // the account already exists and can add a phone number later from /profile.
    fetch(`${BACKEND_URL}/api/auth/me`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ phone: payload.phone.trim() }),
      cache: "no-store",
    }).catch(() => {});
  }

  let user: User;
  try {
    const meResponse = await fetch(`${BACKEND_URL}/api/auth/me`, {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!meResponse.ok) throw new Error("profile fetch failed");
    user = (await meResponse.json()) as User;
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "auth_failed",
          message: "Signed in, but could not load your profile. Please try again.",
        },
      },
      { status: 502 },
    );
  }

  const response = NextResponse.json({ user }, { status: action === "register" ? 201 : 200 });
  response.cookies.set(SESSION_COOKIE, accessToken, sessionCookieOptions(expiresIn));
  response.cookies.set(ROLE_COOKIE, user.role, {
    ...sessionCookieOptions(expiresIn),
    // Readable by the proxy for routing. Never trusted for authorisation.
    httpOnly: false,
  });

  return response;
}

export const dynamic = "force-dynamic";
