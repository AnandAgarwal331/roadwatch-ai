// Two client factories, used deliberately differently:
//
// `userClient(req)` - publishable key + the caller's own JWT forwarded from
// the Authorization header. Every query through this client runs as that
// user via PostgREST, so RLS is the real authorization boundary. Use this
// for straightforward, owner-scoped reads/writes (own complaints, own
// notifications, own profile).
//
// `serviceClient()` - the service role key, kept server-side only and never
// sent to the browser. RLS-bypassing. Use this ONLY inside a flow that has
// already checked its own authorization in code (e.g. "the caller has a
// valid JWT, therefore may submit one report") and then needs a system-wide
// view of the data - the assessment pipeline's history/duplicate search
// needs to see complaints regardless of the caller's own visibility rules,
// the same way the original FastAPI backend's single privileged DB
// connection always could. This is the Edge Function equivalent of the
// `security definer` RPC pattern, used here because the pipeline interleaves
// DB reads/writes with outbound HTTP calls to AI/traffic/places providers -
// something a pure SQL function can't do.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Supabase auto-injects a handful of reserved SUPABASE_*-prefixed secrets
// into every Edge Function (the CLI refuses to let a project set its own
// secret under that prefix - `supabase secrets set SUPABASE_...` is
// rejected outright). SUPABASE_ANON_KEY already holds the plain, ready-to-
// use publishable key string; SUPABASE_PUBLISHABLE_KEYS (plural) is a
// fallback that arrives JSON-encoded as {"default": "<key>", ...} under the
// platform's API-key rotation model, confirmed via a live probe of this
// project's Edge Function runtime.
function firstPublishableKey(): string {
  const direct = Deno.env.get("SUPABASE_ANON_KEY");
  if (direct) return direct;

  const raw = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "";
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const first = parsed.default ?? Object.values(parsed)[0];
      if (first) return String(first);
    }
    if (Array.isArray(parsed) && parsed.length > 0) return String(parsed[0]);
  } catch {
    // Not JSON - either a plain key string, or a comma-separated list.
  }
  return raw.includes(",") ? raw.split(",")[0].trim() : raw;
}

const PUBLISHABLE_KEY = firstPublishableKey();

export function userClient(req: Request): SupabaseClient {
  const authHeader = req.headers.get("Authorization") ?? "";
  return createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

let _service: SupabaseClient | null = null;
export function serviceClient(): SupabaseClient {
  if (!_service) {
    _service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _service;
}

/** The authenticated user's id, or null if the request has no valid session. */
export async function currentUserId(req: Request): Promise<string | null> {
  const { data, error } = await userClient(req).auth.getUser();
  if (error || !data.user) return null;
  return data.user.id;
}

/**
 * Confirms a password without disturbing the caller's own session - used by
 * change-password to re-check the *current* password before GoTrue's
 * updateUser() overwrites it, the same property Python's
 * verify_password(current_password, ...) had. A plain password-grant sign-in
 * against GoTrue is the standard way to do this; it issues its own (unused)
 * session rather than touching the caller's.
 */
export async function verifyPassword(email: string, password: string): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: PUBLISHABLE_KEY },
    body: JSON.stringify({ email, password }),
  });
  return res.ok;
}

/**
 * Sets a new password for the caller. `userClient(req)`'s `.auth.updateUser()`
 * cannot be used for this: that client is built from the forwarded
 * Authorization header alone (no `setSession()` call, since it never holds a
 * refresh token to persist), and supabase-js's auth module needs its own
 * in-memory session state to authorize the request - calling it throws
 * "AuthSessionMissingError" even though the same client's ordinary
 * `.from(...)` PostgREST queries work fine (those read the header directly).
 * Confirmed via a live smoke test. GoTrue's REST endpoint accepts the same
 * bearer token directly, so this goes around supabase-js entirely.
 */
export async function updatePassword(req: Request, newPassword: string): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      apikey: PUBLISHABLE_KEY,
      Authorization: req.headers.get("Authorization") ?? "",
    },
    body: JSON.stringify({ password: newPassword }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to update password: ${res.status} ${body}`);
  }
}
