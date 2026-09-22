// The counting lives in the check_rate_limit() Postgres function, which needs
// a database to exercise. What this file covers is the code around it: which
// key a request is counted under, when the limiter is skipped, and how a
// "no" from the database becomes the 429 the browser sees.

import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { settings } from "./config.ts";
import { RateLimitError } from "./errors.ts";
import { authRateLimit, enforceRateLimit, writeRateLimit } from "./rate_limit.ts";

interface RpcCall {
  fn: string;
  args: { p_bucket_key: string; p_limit_per_minute: number };
}

function fakeClient(answer: { data?: unknown; error?: unknown }): { client: SupabaseClient; calls: RpcCall[] } {
  const calls: RpcCall[] = [];
  const client = {
    rpc(fn: string, args: RpcCall["args"]) {
      calls.push({ fn, args });
      return Promise.resolve({ data: answer.data ?? { allowed: true }, error: answer.error ?? null });
    },
    // deno-lint-ignore no-explicit-any
  } as any as SupabaseClient;
  return { client, calls };
}

function requestFrom(forwardedFor?: string): Request {
  return new Request("http://localhost/api/complaints", {
    headers: forwardedFor ? { "x-forwarded-for": forwardedFor } : {},
  });
}

/** Runs `body` with some settings overridden, restoring them afterwards. */
async function withSettings(overrides: Partial<typeof settings>, body: () => Promise<void>) {
  const original = { ...settings };
  Object.assign(settings, overrides);
  try {
    await body();
  } finally {
    Object.assign(settings, original);
  }
}

Deno.test("a request within the limit goes through", async () => {
  const { client, calls } = fakeClient({ data: { allowed: true } });
  await enforceRateLimit(client, requestFrom("203.0.113.9"), "write", 30);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].fn, "check_rate_limit");
});

Deno.test("a request over the limit becomes a 429 that says when to retry", async () => {
  const { client } = fakeClient({ data: { allowed: false, retry_after_seconds: 42 } });

  const error = await assertRejects(
    () => enforceRateLimit(client, requestFrom("203.0.113.9"), "write", 30),
    RateLimitError,
  );

  assertEquals(error.statusCode, 429);
  assertEquals(error.code, "rate_limited");
  assertEquals(error.details.retry_after_seconds, 42);
});

Deno.test("requests are counted per scope and per client address", async () => {
  const { client, calls } = fakeClient({});
  await enforceRateLimit(client, requestFrom("203.0.113.9"), "write", 30);
  await enforceRateLimit(client, requestFrom("203.0.113.9"), "auth", 10);
  await enforceRateLimit(client, requestFrom("198.51.100.4"), "write", 30);

  assertEquals(calls.map((c) => c.args.p_bucket_key), [
    "write:203.0.113.9",
    "auth:203.0.113.9",
    "write:198.51.100.4",
  ]);
});

Deno.test("only the first address in x-forwarded-for is used, so a caller cannot dodge the limit by appending their own", async () => {
  const { client, calls } = fakeClient({});
  await enforceRateLimit(client, requestFrom("203.0.113.9, 10.0.0.1, 10.0.0.2"), "write", 30);
  assertEquals(calls[0].args.p_bucket_key, "write:203.0.113.9");
});

Deno.test("a request with no forwarding header shares one bucket rather than skipping the limit", async () => {
  const { client, calls } = fakeClient({});
  await enforceRateLimit(client, requestFrom(), "write", 30);
  assertEquals(calls[0].args.p_bucket_key, "write:-");
});

Deno.test("the limit passed in is the one the database is asked to enforce", async () => {
  const { client, calls } = fakeClient({});
  await enforceRateLimit(client, requestFrom("203.0.113.9"), "write", 7);
  assertEquals(calls[0].args.p_limit_per_minute, 7);
});

Deno.test("a limit of zero or less means unlimited and never asks the database", async () => {
  const { client, calls } = fakeClient({ data: { allowed: false } });
  await enforceRateLimit(client, requestFrom("203.0.113.9"), "write", 0);
  await enforceRateLimit(client, requestFrom("203.0.113.9"), "write", -5);
  assertEquals(calls.length, 0);
});

Deno.test("turning the limiter off skips it entirely", async () => {
  await withSettings({ RATE_LIMIT_ENABLED: false }, async () => {
    const { client, calls } = fakeClient({ data: { allowed: false } });
    await enforceRateLimit(client, requestFrom("203.0.113.9"), "write", 30);
    assertEquals(calls.length, 0);
  });
});

Deno.test("a database failure is raised, not treated as permission", async () => {
  const { client } = fakeClient({ error: new Error("connection refused") });
  await assertRejects(
    () => enforceRateLimit(client, requestFrom("203.0.113.9"), "write", 30),
    Error,
    "connection refused",
  );
});

Deno.test("write and auth requests use their own configured limits", async () => {
  await withSettings({ RATE_LIMIT_WRITE_PER_MINUTE: 11, RATE_LIMIT_AUTH_PER_MINUTE: 3 }, async () => {
    const { client, calls } = fakeClient({});
    await writeRateLimit(client, requestFrom("203.0.113.9"));
    await authRateLimit(client, requestFrom("203.0.113.9"));

    assertEquals(calls[0].args, { p_bucket_key: "write:203.0.113.9", p_limit_per_minute: 11 });
    assertEquals(calls[1].args, { p_bucket_key: "auth:203.0.113.9", p_limit_per_minute: 3 });
    assert(calls.length === 2);
  });
});
