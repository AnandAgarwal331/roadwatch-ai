import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ConflictError, ValidationError } from "../_shared/errors.ts";
import { planUserUpdate, type TargetAccount } from "./users.ts";

const ADMIN_ID = "admin-1";
const TEAM = "team-1";
const teamExists = (id: string) => id === TEAM;

function target(overrides: Partial<TargetAccount> = {}): TargetAccount {
  return { id: "user-1", role: "CITIZEN", team_id: null, is_active: true, ...overrides };
}

Deno.test("promoting a citizen to admin changes only the role", () => {
  assertEquals(planUserUpdate(ADMIN_ID, target(), { role: "ADMIN" }, teamExists), { role: "ADMIN" });
});

Deno.test("a crew member needs a team - role alone is rejected", () => {
  assertThrows(() => planUserUpdate(ADMIN_ID, target(), { role: "REPAIR_TEAM" }, teamExists), ValidationError);
});

Deno.test("role and team together make a crew member", () => {
  assertEquals(
    planUserUpdate(ADMIN_ID, target(), { role: "REPAIR_TEAM", team_id: TEAM }, teamExists),
    { role: "REPAIR_TEAM", team_id: TEAM },
  );
});

Deno.test("an unknown team is rejected", () => {
  assertThrows(() => planUserUpdate(ADMIN_ID, target(), { role: "REPAIR_TEAM", team_id: "nope" }, teamExists), ValidationError);
});

Deno.test("an existing crew member can move teams without resending the role", () => {
  const crew = target({ role: "REPAIR_TEAM", team_id: "old" });
  assertEquals(planUserUpdate(ADMIN_ID, crew, { team_id: TEAM }, teamExists), { team_id: TEAM });
});

Deno.test("demoting a crew member to citizen clears their team", () => {
  const crew = target({ role: "REPAIR_TEAM", team_id: TEAM });
  assertEquals(planUserUpdate(ADMIN_ID, crew, { role: "CITIZEN" }, teamExists), { role: "CITIZEN", team_id: null });
});

Deno.test("an admin keeps their team when promoted, so they can still use the crew console", () => {
  const crew = target({ role: "REPAIR_TEAM", team_id: TEAM });
  assertEquals(planUserUpdate(ADMIN_ID, crew, { role: "ADMIN" }, teamExists), { role: "ADMIN" });
});

Deno.test("an admin cannot demote or deactivate themselves", () => {
  const self = target({ id: ADMIN_ID, role: "ADMIN" });
  assertThrows(() => planUserUpdate(ADMIN_ID, self, { role: "CITIZEN" }, teamExists), ConflictError);
  assertThrows(() => planUserUpdate(ADMIN_ID, self, { is_active: false }, teamExists), ConflictError);
});

Deno.test("an admin may still edit their own team link", () => {
  const self = target({ id: ADMIN_ID, role: "ADMIN" });
  assertEquals(planUserUpdate(ADMIN_ID, self, { team_id: TEAM }, teamExists), { team_id: TEAM });
});

Deno.test("invalid role values are rejected", () => {
  assertThrows(() => planUserUpdate(ADMIN_ID, target(), { role: "SUPERUSER" }, teamExists), ValidationError);
  assertThrows(() => planUserUpdate(ADMIN_ID, target(), { role: 5 }, teamExists), ValidationError);
});

Deno.test("a request that changes nothing is rejected", () => {
  assertThrows(() => planUserUpdate(ADMIN_ID, target(), { role: "CITIZEN" }, teamExists), ValidationError);
  assertThrows(() => planUserUpdate(ADMIN_ID, target(), {}, teamExists), ValidationError);
});
