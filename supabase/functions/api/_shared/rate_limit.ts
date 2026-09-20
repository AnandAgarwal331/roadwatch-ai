// Ported from backend/app/core/rate_limit.py. The counting itself lives in
// the check_rate_limit() Postgres function (see
// supabase/migrations/20260920020000_rate_limit_rpc.sql) since Edge
// Functions are stateless between invocations, unlike the FastAPI process
// the in-memory version relied on.

import type { SupabaseClient } from "@supabase/supabase-js";
import { settings } from "./config.ts";
import { RateLimitError } from "./errors.ts";

function clientKey(req: Request, scope: string): string {
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded ? forwarded.split(",")[0].trim() : "-";
  return `${scope}:${ip}`;
}

export async function enforceRateLimit(
  client: SupabaseClient,
  req: Request,
  scope: string,
  limitPerMinute: number,
): Promise<void> {
  if (!settings.RATE_LIMIT_ENABLED || limitPerMinute <= 0) return;

  const { data, error } = await client.rpc("check_rate_limit", {
    p_bucket_key: clientKey(req, scope),
    p_limit_per_minute: limitPerMinute,
  });
  if (error) throw error;

  if (!data.allowed) {
    throw new RateLimitError("Too many requests. Please wait a moment and try again.", {
      retry_after_seconds: data.retry_after_seconds,
    });
  }
}

export function writeRateLimit(client: SupabaseClient, req: Request): Promise<void> {
  return enforceRateLimit(client, req, "write", settings.RATE_LIMIT_WRITE_PER_MINUTE);
}

export function authRateLimit(client: SupabaseClient, req: Request): Promise<void> {
  return enforceRateLimit(client, req, "auth", settings.RATE_LIMIT_AUTH_PER_MINUTE);
}
