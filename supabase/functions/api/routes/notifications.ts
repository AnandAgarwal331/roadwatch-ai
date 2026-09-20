// Ported from backend/app/api/v1/notifications.py. All owner-scoped, backed
// directly by RLS ("notifications_select_own"/"notifications_update_own" -
// see the RLS migration), so no RPC is needed here.

import { Hono } from "hono";
import { requireUser } from "../_shared/auth.ts";
import { userClient } from "../_shared/supabase.ts";
import { NotFoundError } from "../_shared/errors.ts";

export const notifications = new Hono();

notifications.get("/", async (c) => {
  const req = c.req.raw;
  const user = await requireUser(req);
  const client = userClient(req);
  const url = new URL(req.url);
  const unreadOnly = url.searchParams.get("unread_only") === "true";
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? "30")));

  let query = client.from("notifications").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(limit);
  if (unreadOnly) query = query.eq("is_read", false);
  const { data: items, error } = await query;
  if (error) throw error;

  const { count, error: countErr } = await client
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("is_read", false);
  if (countErr) throw countErr;

  return c.json({ items: items ?? [], unread_count: count ?? 0 });
});

notifications.post("/:id/read", async (c) => {
  const req = c.req.raw;
  const user = await requireUser(req);
  const client = userClient(req);
  const id = c.req.param("id");

  const { data: notification, error } = await client.from("notifications").select("id, user_id, is_read").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!notification || notification.user_id !== user.id) {
    throw new NotFoundError("That notification could not be found.");
  }

  if (!notification.is_read) {
    const { error: updateErr } = await client
      .from("notifications")
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq("id", id);
    if (updateErr) throw updateErr;
  }

  return c.json({ message: "Marked as read." });
});

notifications.post("/read-all", async (c) => {
  const req = c.req.raw;
  const user = await requireUser(req);
  const client = userClient(req);

  const { data: unread, error } = await client
    .from("notifications")
    .select("id")
    .eq("user_id", user.id)
    .eq("is_read", false)
    .limit(500);
  if (error) throw error;

  if ((unread ?? []).length > 0) {
    const { error: updateErr } = await client
      .from("notifications")
      .update({ is_read: true, read_at: new Date().toISOString() })
      .in("id", (unread ?? []).map((row) => row.id));
    if (updateErr) throw updateErr;
  }

  return c.json({ message: `${(unread ?? []).length} notification(s) marked as read.` });
});
