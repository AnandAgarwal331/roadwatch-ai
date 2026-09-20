// The Edge Function entrypoint. One Hono app, mounting sub-routers that
// mirror the original FastAPI routers' path prefixes 1:1 - see the plan's
// "Target architecture" section for why this is one function rather than
// many. Supabase serves this function at /functions/v1/api/*, so every
// route below is registered under the "/api" base path.

import { Hono } from "hono";
import { AppError } from "./_shared/errors.ts";
import { settings } from "./_shared/config.ts";
import { complaints } from "./routes/complaints.ts";
import { publicStats } from "./routes/public.ts";
import { map } from "./routes/map.ts";
import { notifications } from "./routes/notifications.ts";
import { auth } from "./routes/auth.ts";
import { team } from "./routes/team.ts";
import { admin } from "./routes/admin.ts";

const app = new Hono().basePath("/api");

app.use("*", async (c, next) => {
  const origin = c.req.header("Origin") ?? "";
  const allowed = settings.CORS_ORIGINS.includes(origin);
  if (c.req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": allowed ? origin : settings.CORS_ORIGINS[0] ?? "",
        "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "authorization,content-type,apikey,x-client-info",
        "Access-Control-Max-Age": "86400",
      },
    });
  }
  await next();
  if (allowed) c.res.headers.set("Access-Control-Allow-Origin", origin);
});

app.route("/complaints", complaints);
app.route("/stats", publicStats);
app.route("/map", map);
app.route("/notifications", notifications);
app.route("/auth", auth);
app.route("/team", team);
app.route("/admin", admin);

app.get("/health", (c) => c.json({ status: "ok" }));

app.onError((err, c) => {
  if (err instanceof AppError) return err.toResponse();
  console.error(err);
  return c.json({ error: { code: "internal_error", message: "Something went wrong. Please try again." } }, 500);
});

app.notFound((c) => c.json({ error: { code: "not_found", message: "Not found." } }, 404));

Deno.serve(app.fetch);
