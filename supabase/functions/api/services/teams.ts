// When a repair crew may be deleted. Kept apart from the HTTP route so the
// rule can be unit tested without a database.
//
// Two things in the schema make an unconditional delete dangerous:
//  - repair_assignments.team_id is ON DELETE CASCADE: deleting the crew would
//    silently erase every job it ever had, including completed repairs and
//    their evidence photos, and leave reports marked ASSIGNED/IN_PROGRESS with
//    no assignment behind them.
//  - profiles.team_id is ON DELETE SET NULL: crew members would be detached
//    without warning and land on "your account is not linked to a repair team".
// Deactivating a crew (is_active = false) already retires it without either
// problem, so that is what the refusal points to.

import { ConflictError } from "../_shared/errors.ts";

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function assertTeamDeletable(teamName: string, jobCount: number, memberCount: number): void {
  if (jobCount > 0) {
    throw new ConflictError(
      `${teamName} has ${plural(jobCount, "job", "jobs")} on record, and deleting the crew would erase them ` +
        "along with their repair evidence. Deactivate the crew instead - it stops taking new work but keeps its history.",
      { jobs: jobCount },
    );
  }
  if (memberCount > 0) {
    throw new ConflictError(
      `${teamName} still has ${plural(memberCount, "member", "members")}. ` +
        "Move them to another crew or change their role on the Users page first.",
      { members: memberCount },
    );
  }
}
