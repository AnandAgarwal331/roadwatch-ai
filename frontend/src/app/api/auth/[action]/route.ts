/**
 * Session endpoints: login, register, logout, keepalive.
 *
 * Kept separate from the generic proxy because these are the only routes that
 * write the session cookies (the generic proxy and the route guard only renew
 * them). On success the Supabase session's access and refresh tokens are
 * written into httpOnly cookies and stripped from the response body, so they
 * never reach client JavaScript.
 *
 * Login and register talk to Supabase Auth (GoTrue) directly rather than
 * through the Edge Function - they *are* what Supabase Auth already is, so a
 * wrapper endpoint on the backend would just be a slower detour to the same
 * place. The profile (role, full_name, phone - the shape the rest of this
 * app expects as `User`) is a separate concept GoTrue doesn't carry, read
 * afterwards from the `profiles` table (see `fetchProfile`).
 */

import { NextRequest, NextResponse } from "next/server";

import {
  BACKEND_URL,
  clearSessionCookies,
  fetchProfile,
  forgetProfile,
  REFRESH_COOKIE,
  rememberProfile,
  resolveSession,
  ROLE_COOKIE,
  SESSION_COOKIE,
  setSessionCookies,
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
} from "@/lib/session";
import { passwordProblem } from "@/lib/password-rules";

const ACTIONS = { login: "/auth/v1/token?grant_type=password", register: "/auth/v1/signup" } as const;

type Action = keyof typeof ACTIONS;

/** Supabase's answer when the address has not been confirmed yet, in words a person can act on. */
const UNCONFIRMED_MESSAGE =
  "Please confirm your email address first. We sent you a link when you registered - check your inbox and spam folder.";

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
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    if (token) {
      forgetProfile(token);
      // Best-effort server-side session revocation; a failure here must
      // never block the client-side cookie clear the user is waiting on.
      fetch(`${SUPABASE_URL}/auth/v1/logout`, {
        method: "POST",
        headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` },
        cache: "no-store",
      }).catch(() => {});
    }

    const response = NextResponse.json({ message: "Signed out." });
    clearSessionCookies(response);
    return response;
  }

  if (action === "keepalive") {
    // Called by the browser while the user is active. Renews the access token
    // if it is close to expiring and slides the cookies' lifetime forward, so
    // "active users stay signed in, idle users do not" holds even though the
    // token itself is short-lived.
    const session = await resolveSession(
      request.cookies.get(SESSION_COOKIE)?.value,
      request.cookies.get(REFRESH_COOKIE)?.value,
    );

    if (session.state === "none" || session.state === "expired") {
      const response = NextResponse.json(
        { error: { code: "unauthenticated", message: "Your session has expired. Please sign in again." } },
        { status: 401 },
      );
      clearSessionCookies(response);
      return response;
    }

    const accessToken = session.accessToken;
    if (!accessToken) return unreachableResponse();

    const response = NextResponse.json({ ok: true });
    setSessionCookies(response, {
      accessToken,
      refreshToken:
        session.state === "unavailable"
          ? request.cookies.get(REFRESH_COOKIE)?.value
          : session.refreshToken,
      role: request.cookies.get(ROLE_COOKIE)?.value,
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

  if (action === "register") {
    // The form checks this too, but the form is not the only way to reach this
    // route, and Supabase's own minimum is looser (see config.toml).
    const problem = passwordProblem(payload.password);
    if (problem) {
      return NextResponse.json(
        { error: { code: "validation_error", message: problem } },
        { status: 422 },
      );
    }
  }

  const body =
    action === "register"
      ? {
          email: payload.email,
          password: payload.password,
          // Read by the handle_new_user() trigger to seed the profile. With
          // email confirmation on there is no session yet to PATCH /auth/me
          // with, so the phone has to travel here.
          data: {
            full_name: payload.full_name,
            ...(typeof payload.phone === "string" && payload.phone.trim()
              ? { phone: payload.phone.trim() }
              : {}),
          },
        }
      : { email: payload.email, password: payload.password };

  // Where the link in the confirmation email lands. Must be on the Supabase
  // project's allowed redirect list (see README, "Before going live").
  const endpoint =
    action === "register"
      ? `${ACTIONS.register}?redirect_to=${encodeURIComponent(`${request.nextUrl.origin}/login?confirmed=1`)}`
      : ACTIONS.login;

  let authResponse: Response;
  try {
    authResponse = await fetch(`${SUPABASE_URL}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_PUBLISHABLE_KEY },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    return unreachableResponse();
  }

  const authBody = await authResponse.json().catch(() => null);

  if (action === "register" && authResponse.ok && !authBody?.access_token) {
    // Email confirmation is on: the account exists but has no session until
    // the link in the email is opened. The answer is the same whether or not
    // the address was already registered, so this form cannot be used to find
    // out who has an account.
    return NextResponse.json(
      {
        needs_confirmation: true,
        message: "Almost done - we sent a confirmation link to your email. Open it, then sign in.",
      },
      { status: 202 },
    );
  }

  if (!authResponse.ok || !authBody?.access_token) {
    const unconfirmed = authBody?.error_code === "email_not_confirmed";
    const message = unconfirmed
      ? UNCONFIRMED_MESSAGE
      : (authBody?.msg ?? authBody?.error_description ?? "Could not sign you in. Please try again.");
    return NextResponse.json(
      { error: { code: unconfirmed ? "email_not_confirmed" : "auth_failed", message } },
      { status: authResponse.status || 500 },
    );
  }

  const accessToken = authBody.access_token as string;
  const refreshToken = typeof authBody.refresh_token === "string" ? authBody.refresh_token : null;

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

  // Straight from the database rather than the Edge Function: this is the
  // slowest step of signing in and needs nothing the database cannot answer.
  const user = await fetchProfile(accessToken);
  if (!user) {
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
  if (!user.is_active) {
    return NextResponse.json(
      { error: { code: "account_deactivated", message: "This account has been deactivated." } },
      { status: 403 },
    );
  }

  const response = NextResponse.json({ user }, { status: action === "register" ? 201 : 200 });
  setSessionCookies(response, { accessToken, refreshToken, role: user.role });
  // The page the browser is about to load asks for this same profile; hand it over.
  rememberProfile(accessToken, user);

  return response;
}

export const dynamic = "force-dynamic";
