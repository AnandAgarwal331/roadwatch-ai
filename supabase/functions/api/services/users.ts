// Admin management of accounts: role and crew membership. Until this existed
// the only way to make someone an admin or put them on a crew was editing the
// profiles table by hand. The rules live here, apart from the HTTP route, so
// they can be unit tested without a database.

import { ConflictError, ValidationError } from "../_shared/errors.ts";
import type { UserRole } from "../_shared/enums.ts";

const ROLES: UserRole[] = ["CITIZEN", "ADMIN", "REPAIR_TEAM"];

export interface UserUpdateRequest {
  role?: unknown;
  team_id?: unknown;
  is_active?: unknown;
}

export interface TargetAccount {
  id: string;
  role: UserRole;
  team_id: string | null;
  is_active: boolean;
}

export interface UserChanges {
  role?: UserRole;
  team_id?: string | null;
  is_active?: boolean;
}

/**
 * Validates an admin's requested change to an account and returns exactly
 * what should be written. Throws instead of returning a partial plan.
 *
 * - An admin cannot change their own role or deactivate themselves: with the
 *   only admin locked out, the fix would be a hand-edit in the database.
 * - A crew member must end up on a team.
 * - A plain citizen never carries a team; admins may (they can use the crew
 *   console for the team they belong to).
 */
export function planUserUpdate(
  actorId: string,
  target: TargetAccount,
  body: UserUpdateRequest,
  teamExists: (teamId: string) => boolean,
): UserChanges {
  const changes: UserChanges = {};

  if (body.role !== undefined) {
    if (typeof body.role !== "string" || !ROLES.includes(body.role as UserRole)) {
      throw new ValidationError("Role must be CITIZEN, ADMIN or REPAIR_TEAM.");
    }
    changes.role = body.role as UserRole;
  }

  if (body.team_id !== undefined) {
    if (body.team_id !== null && typeof body.team_id !== "string") {
      throw new ValidationError("team_id must be a team id or null.");
    }
    if (typeof body.team_id === "string" && !teamExists(body.team_id)) {
      throw new ValidationError("That repair team does not exist.");
    }
    changes.team_id = body.team_id as string | null;
  }

  if (body.is_active !== undefined) {
    if (typeof body.is_active !== "boolean") throw new ValidationError("is_active must be true or false.");
    changes.is_active = body.is_active;
  }

  const selfEdit = actorId === target.id;
  if (selfEdit && ((changes.role && changes.role !== target.role) || changes.is_active === false)) {
    throw new ConflictError(
      "You cannot change your own role or deactivate your own account - ask another admin, so the system is never left without one.",
    );
  }

  const finalRole = changes.role ?? target.role;
  if (finalRole === "CITIZEN") changes.team_id = null;

  const finalTeam = "team_id" in changes ? changes.team_id : target.team_id;
  if (finalRole === "REPAIR_TEAM" && !finalTeam) {
    throw new ValidationError("A repair crew member must be assigned to a team.");
  }

  const effective = Object.entries(changes).filter(
    ([key, value]) => (target as unknown as Record<string, unknown>)[key] !== value,
  );
  if (effective.length === 0) throw new ValidationError("Nothing to change.");

  return Object.fromEntries(effective) as UserChanges;
}
