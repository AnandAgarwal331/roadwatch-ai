/**
 * Session endpoints: login, register, logout.
 *
 * Kept separate from the generic proxy because these are the only routes that
 * touch cookies. On success the backend's access token is written into an
 * httpOnly cookie and stripped from the response body, so it never reaches
 * client JavaScript.
 */

import { NextRequest, NextResponse } from "next/server";

import {
  BACKEND_URL,
  ROLE_COOKIE,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/session";
import type { AuthResponse } from "@/types";

const ACTIONS = { login: "/api/auth/login", register: "/api/auth/register" } as const;

type Action = keyof typeof ACTIONS;

function isAction(value: string): value is Action {
  return value in ACTIONS;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ action: string }> },
) {
  const { action } = await context.params;

  if (action === "logout") {
    const response = NextResponse.json({ message: "Signed out." });
    // maxAge 0 clears rather than merely expiring on the client's clock.
    response.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(0) });
    response.cookies.set(ROLE_COOKIE, "", {
      ...sessionCookieOptions(0),
      httpOnly: false,
    });
    return response;
  }

  if (!isAction(action)) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Unknown action." } },
      { status: 404 },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${BACKEND_URL}${ACTIONS[action]}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: await request.text(),
      cache: "no-store",
    });
  } catch {
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

  const body = await upstream.json().catch(() => null);

  if (!upstream.ok || !body) {
    return NextResponse.json(
      body ?? {
        error: { code: "auth_failed", message: "Could not sign you in. Please try again." },
      },
      { status: upstream.status || 500 },
    );
  }

  const auth = body as AuthResponse;

  // The token goes to the cookie only - the client receives just the user.
  const response = NextResponse.json({ user: auth.user }, { status: upstream.status });
  response.cookies.set(SESSION_COOKIE, auth.access_token, sessionCookieOptions(auth.expires_in));
  response.cookies.set(ROLE_COOKIE, auth.user.role, {
    ...sessionCookieOptions(auth.expires_in),
    // Readable by middleware for routing. Never trusted for authorisation.
    httpOnly: false,
  });

  return response;
}

export const dynamic = "force-dynamic";
