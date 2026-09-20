// nextComplaintNumber() is the one piece of pure-ish logic in this file that
// still needs a database round trip (finding the highest number issued this
// year), so it's tested here against a tiny fake Supabase client that mimics
// just the postgrest-js chain the function actually calls, rather than a
// live database.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nextComplaintNumber } from "./numbering.ts";

function fakeClient(opts: { highest?: string | null; fallbackCount?: number }): SupabaseClient {
  const client = {
    from(_table: string) {
      return {
        select(_cols: string, selectOpts?: { count?: string; head?: boolean }) {
          if (selectOpts?.count) {
            // The malformed-number fallback: a plain count query, awaited directly.
            return { like: (_col: string, _pattern: string) => Promise.resolve({ count: opts.fallbackCount ?? 0, error: null }) };
          }
          // The normal path: highest complaint_number this year.
          return {
            like: (_col: string, _pattern: string) => ({
              order: (_col2: string, _o?: unknown) => ({
                limit: (_n: number) => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: opts.highest ? { complaint_number: opts.highest } : null,
                      error: null,
                    }),
                }),
              }),
            }),
          };
        },
      };
    },
    // deno-lint-ignore no-explicit-any
  } as any;
  return client as SupabaseClient;
}

Deno.test("the first complaint of a year gets sequence 000001", async () => {
  const number = await nextComplaintNumber(fakeClient({ highest: null }), 2026);
  assertEquals(number, "RW-2026-000001");
});

Deno.test("the next number increments the highest one issued this year", async () => {
  const number = await nextComplaintNumber(fakeClient({ highest: "RW-2026-000041" }), 2026);
  assertEquals(number, "RW-2026-000042");
});

Deno.test("sequence numbers are zero-padded to 6 digits", async () => {
  const number = await nextComplaintNumber(fakeClient({ highest: "RW-2026-000009" }), 2026);
  assertEquals(number, "RW-2026-000010");
});

Deno.test("a malformed highest number falls back to counting rows for the year", async () => {
  const number = await nextComplaintNumber(fakeClient({ highest: "RW-2026-not-a-number", fallbackCount: 7 }), 2026);
  assertEquals(number, "RW-2026-000008");
});

Deno.test("numbers use the requested year, not always the current one", async () => {
  const number = await nextComplaintNumber(fakeClient({ highest: null }), 2025);
  assertEquals(number, "RW-2025-000001");
});
