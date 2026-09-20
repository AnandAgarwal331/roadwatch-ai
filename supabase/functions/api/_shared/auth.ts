// Ported from backend/app/api/deps.py. Nothing trusts a role claim from the
// JWT itself: the caller's id comes from the verified token (currentUserId,
// which asks GoTrue), but the role is re-read from `profiles` on every
// call, so a deactivated or demoted account loses access immediately rather
// than at token expiry - same property Python's get_current_user had by
// re-reading the User row on every request.

import { AuthenticationError, PermissionDeniedError } from "./errors.ts";
import { currentUserId, userClient } from "./supabase.ts";
import type { UserRole } from "./enums.ts";

export interface AuthedProfile {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  role: UserRole;
  is_active: boolean;
  team_id: string | null;
  created_at: string;
}

export async function requireUser(req: Request): Promise<AuthedProfile> {
  const userId = await currentUserId(req);
  if (!userId) throw new AuthenticationError("You need to sign in to do that.");

  const { data, error } = await userClient(req).from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) throw error;
  if (!data) throw new AuthenticationError("That account no longer exists.");
  if (!data.is_active) throw new PermissionDeniedError("This account has been deactivated.");
  return data as AuthedProfile;
}

/** For endpoints that are public but richer when signed in. */
export async function optionalUser(req: Request): Promise<AuthedProfile | null> {
  try {
    return await requireUser(req);
  } catch {
    return null;
  }
}

export function requireRoles(profile: AuthedProfile, ...roles: UserRole[]): void {
  if (!roles.includes(profile.role)) {
    throw new PermissionDeniedError("You do not have permission to do that.", {
      required_roles: [...roles].sort(),
    });
  }
}

export async function requireAdmin(req: Request): Promise<AuthedProfile> {
  const user = await requireUser(req);
  requireRoles(user, "ADMIN");
  return user;
}

export async function requireTeam(req: Request): Promise<AuthedProfile> {
  const user = await requireUser(req);
  requireRoles(user, "REPAIR_TEAM", "ADMIN");
  return user;
}
