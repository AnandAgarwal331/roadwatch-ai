/**
 * Backend proxy (BFF).
 *
 * Every browser request to the API passes through here so the access token can
 * be read from the httpOnly cookie server-side and attached as a bearer header.
 * The token is therefore never readable by client JavaScript, which is the
 * whole reason for the indirection.
 *
 * The proxy is deliberately dumb: it forwards method, query string and body,
 * and returns the backend's status and body unchanged so `ApiError` on the
 * client sees exactly what FastAPI produced.
 */

import { NextRequest, NextResponse } from "next/server";

import {
  BACKEND_URL,
  clearSessionCookies,
  forgetProfile,
  REFRESH_COOKIE,
  resolveSession,
  ROLE_COOKIE,
  SESSION_COOKIE,
  setSessionCookies,
  SUPABASE_PUBLISHABLE_KEY,
} from "@/lib/session";
import { sharedCache } from "@/lib/ttl-cache";

/** Hop-by-hop and identity headers that must not be relayed upstream. */
const STRIPPED_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "content-length",
  "cookie",
  "authorization",
]);

const STRIPPED_RESPONSE_HEADERS = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
]);

interface BufferedResponse {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: ArrayBuffer;
}

/**
 * Answers to signed-out GET requests, kept briefly.
 *
 * The public feed, the map and the stats are the same for every visitor, and
 * the backend behind them can take a second or more, so the first visitor pays
 * and everyone after gets the answer instantly - a stale answer is served
 * immediately while a fresh one is fetched for the next person. Only requests
 * with no session are cached (nothing here can be personal to a user), only
 * 200 responses are kept, and a signed-in user always goes to the backend.
 */
const anonymousReads = sharedCache<BufferedResponse>("anonymous-reads", {
  maxEntries: 200,
  freshMs: 30_000,
  staleMs: 5 * 60_000,
});
const MAX_CACHED_BYTES = 1024 * 1024;

function copyHeaders(source: Headers): Headers {
  const copy = new Headers();
  source.forEach((value, key) => {
    if (!STRIPPED_RESPONSE_HEADERS.has(key.toLowerCase())) copy.set(key, value);
  });
  return copy;
}

async function handler(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const target = `${BACKEND_URL}/api/${path.join("/")}${request.nextUrl.search}`;

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!STRIPPED_REQUEST_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  });

  // Required by Supabase's own gateway in front of the Edge Function, on top
  // of whatever auth the function code does - it is not a secret (see
  // lib/session.ts), so it goes on every request, signed in or not.
  headers.set("apikey", SUPABASE_PUBLISHABLE_KEY);

  // The route guard renews the token on page loads, but a tab left open can
  // make API calls long after that, so the same renewal happens here.
  const session = await resolveSession(
    request.cookies.get(SESSION_COOKIE)?.value,
    request.cookies.get(REFRESH_COOKIE)?.value,
  );
  const token = session.state === "none" || session.state === "expired" ? null : session.accessToken;
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  // Applied to whichever response goes back, including the error ones.
  const withSessionCookies = (response: NextResponse) => {
    if (session.state === "renewed") {
      setSessionCookies(response, {
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        role: request.cookies.get(ROLE_COOKIE)?.value,
      });
    } else if (session.state === "expired") {
      clearSessionCookies(response);
    }
    return response;
  };

  const method = request.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";

  const unreachable = () =>
    withSessionCookies(
      NextResponse.json(
        {
          error: {
            code: "backend_unreachable",
            message: "The RoadWatch service is not responding. Please try again in a moment.",
          },
        },
        { status: 503 },
      ),
    );

  if (method === "GET" && !token) {
    try {
      const { value, state } = await anonymousReads.getOrLoad(
        target,
        async () => {
          const upstream = await fetch(target, { method, headers, redirect: "manual", cache: "no-store" });
          return {
            status: upstream.status,
            statusText: upstream.statusText,
            headers: [...copyHeaders(upstream.headers).entries()],
            body: await upstream.arrayBuffer(),
          };
        },
        (stored) => stored.status === 200 && stored.body.byteLength <= MAX_CACHED_BYTES,
      );

      const cachedHeaders = new Headers(value.headers);
      // Handy when checking why a page was quick or slow.
      cachedHeaders.set("x-rw-cache", state);
      return withSessionCookies(
        new NextResponse(value.body, {
          status: value.status,
          statusText: value.statusText,
          headers: cachedHeaders,
        }),
      );
    } catch {
      return unreachable();
    }
  }

  let response: Response;
  try {
    response = await fetch(target, {
      method,
      headers,
      // Stream the body through untouched so multipart uploads keep their
      // boundary and are not buffered into memory twice.
      body: hasBody ? await request.arrayBuffer() : undefined,
      redirect: "manual",
      cache: "no-store",
    });
  } catch {
    return unreachable();
  }

  // The user just changed something about their own account (name, phone,
  // password): drop the remembered profile so the very next page shows it.
  if (token && hasBody && response.ok && path[0] === "auth") forgetProfile(token);

  const responseHeaders = copyHeaders(response.headers);

  return withSessionCookies(
    new NextResponse(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    }),
  );
}

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const PUT = handler;
export const DELETE = handler;

// Auth state must never be cached.
export const dynamic = "force-dynamic";
