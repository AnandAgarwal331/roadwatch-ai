// Ported from backend/app/services/audit.py. Append-only: nothing here ever
// updates or deletes a row. Always the service client - audit_logs has no
// client-facing insert policy (RPC/system-write only, see the RLS
// migration), and every caller has already passed requireAdmin(req).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthedProfile } from "../_shared/auth.ts";

export interface AuditEntryInput {
  actor: AuthedProfile | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  complaintId?: string | null;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  note?: string | null;
  ipAddress?: string | null;
}

export async function recordAudit(client: SupabaseClient, input: AuditEntryInput): Promise<void> {
  const { error } = await client.from("audit_logs").insert({
    actor_id: input.actor?.id ?? null,
    // Denormalised so the trail stays readable even if the account is later deleted.
    actor_email: input.actor?.email ?? null,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    complaint_id: input.complaintId ?? null,
    old_value: input.oldValue ?? null,
    new_value: input.newValue ?? null,
    note: input.note ?? null,
    ip_address: input.ipAddress ?? null,
  });
  if (error) throw error;
}

export async function listRecentAudit(
  client: SupabaseClient,
  opts: { complaintId?: string; limit?: number } = {},
): Promise<Record<string, unknown>[]> {
  let query = client.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(opts.limit ?? 100);
  if (opts.complaintId) query = query.eq("complaint_id", opts.complaintId);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}
