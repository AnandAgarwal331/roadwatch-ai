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

import { BACKEND_URL, getSessionToken, SUPABASE_PUBLISHABLE_KEY } from "@/lib/session";

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

  const token = await getSessionToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const method = request.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";

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
    return NextResponse.json(
      {
        error: {
          code: "backend_unreachable",
          message:
            "The RoadWatch service is not responding. Please try again in a moment.",
        },
      },
      { status: 503 },
    );
  }

  const responseHeaders = new Headers();
  response.headers.forEach((value, key) => {
    if (!STRIPPED_RESPONSE_HEADERS.has(key.toLowerCase())) {
      responseHeaders.set(key, value);
    }
  });

  return new NextResponse(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const PUT = handler;
export const DELETE = handler;

// Auth state must never be cached.
export const dynamic = "force-dynamic";
