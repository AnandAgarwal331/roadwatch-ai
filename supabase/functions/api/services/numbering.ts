// Ported from backend/app/services/numbering.py. Human-friendly complaint
// numbers, e.g. "RW-2026-001024". Numbers restart each calendar year.
//
// The Python version derives the next number from the highest one issued
// this year and relies on the table's unique constraint to catch a race
// between two concurrent submissions (retrying on IntegrityError). Postgres
// raises unique-violation as error code 23505 for the same case - callers
// of nextComplaintNumber should catch that from the insert and retry, same
// as the original.

import type { SupabaseClient } from "@supabase/supabase-js";

const PREFIX = "RW";
const SEQUENCE_WIDTH = 6;

export async function nextComplaintNumber(client: SupabaseClient, year?: number): Promise<string> {
  const y = year ?? new Date().getUTCFullYear();
  const prefix = `${PREFIX}-${y}-`;

  const { data, error } = await client
    .from("complaints")
    .select("complaint_number")
    .like("complaint_number", `${prefix}%`)
    .order("complaint_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;

  let sequence = 1;
  const highest = data?.complaint_number as string | undefined;
  if (highest) {
    const tail = highest.split("-").at(-1);
    const parsed = tail ? Number.parseInt(tail, 10) : NaN;
    if (!Number.isNaN(parsed)) {
      sequence = parsed + 1;
    } else {
      // A malformed row must not stop new reports; fall back to counting.
      const { count, error: countErr } = await client
        .from("complaints")
        .select("id", { count: "exact", head: true })
        .like("complaint_number", `${prefix}%`);
      if (countErr) throw countErr;
      sequence = (count ?? 0) + 1;
    }
  }

  return `${prefix}${String(sequence).padStart(SEQUENCE_WIDTH, "0")}`;
}
