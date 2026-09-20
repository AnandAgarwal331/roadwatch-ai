// Ported from backend/app/api/v1/auth.py - but scoped down to /me and
// /change-password only. register/login/logout move to the frontend
// calling Supabase Auth directly (its own /signup, /token, session clear),
// per the migration plan's Phase 4 scope: those are exactly what Supabase
// Auth already is, so a wrapper here would just be a slower detour to the
// same GoTrue endpoints. /me and /change-password stay because they carry
// real logic beyond plain auth: profiles bookkeeping and re-verifying the
// current password before GoTrue overwrites it.

import { Hono } from "hono";
import { requireUser } from "../_shared/auth.ts";
import { updatePassword, userClient, verifyPassword } from "../_shared/supabase.ts";
import { AuthenticationError, ValidationError } from "../_shared/errors.ts";
import { authRateLimit } from "../_shared/rate_limit.ts";

export const auth = new Hono();

const MAX_PASSWORD_LENGTH = 72;
const MIN_PASSWORD_LENGTH = 8;

function passwordStrengthError(value: string): string | null {
  if (value.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (new TextEncoder().encode(value).length > MAX_PASSWORD_LENGTH) return "Password is too long";
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) return "Password must contain at least one letter and one number";
  return null;
}

auth.get("/me", async (c) => c.json(await requireUser(c.req.raw)));

auth.patch("/me", async (c) => {
  const req = c.req.raw;
  const user = await requireUser(req);
  const body = await req.json().catch(() => ({}));

  let fullName = user.full_name;
  if (typeof body.full_name === "string") {
    const cleaned = body.full_name.split(/\s+/).filter(Boolean).join(" ");
    if (cleaned.length < 2) throw new ValidationError("Please enter your name");
    fullName = cleaned;
  }

  let phone = user.phone;
  if ("phone" in body) {
    phone = typeof body.phone === "string" ? body.phone.trim() || null : null;
  }

  const { data, error } = await userClient(req).rpc("update_own_profile", {
    p_full_name: fullName,
    p_phone: phone,
  });
  if (error) throw error;
  return c.json(data);
});

auth.post("/change-password", async (c) => {
  const req = c.req.raw;
  const client = userClient(req);
  await authRateLimit(client, req);
  const user = await requireUser(req);

  const body = await req.json().catch(() => ({}));
  const currentPassword = body.current_password;
  const newPassword = body.new_password;
  if (typeof currentPassword !== "string" || currentPassword.length === 0) {
    throw new ValidationError("Please enter your current password.");
  }
  if (typeof newPassword !== "string") throw new ValidationError("Please enter a new password.");
  const strengthError = passwordStrengthError(newPassword);
  if (strengthError) throw new ValidationError(strengthError);

  const currentOk = await verifyPassword(user.email, currentPassword);
  if (!currentOk) throw new AuthenticationError("Your current password is not correct.");

  await updatePassword(req, newPassword);

  return c.json({ message: "Your password has been changed." });
});
