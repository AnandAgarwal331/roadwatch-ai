import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ConflictError } from "../_shared/errors.ts";
import { assertTeamDeletable } from "./teams.ts";

Deno.test("an empty crew with no jobs can be deleted", () => {
  assertTeamDeletable("Crew A", 0, 0);
});

Deno.test("a crew with job history cannot be deleted, and the message points to deactivating", () => {
  const error = assertThrows(() => assertTeamDeletable("Crew A", 3, 0), ConflictError);
  assertEquals(error.message.includes("Deactivate"), true);
  assertEquals(error.message.includes("3 jobs"), true);
});

Deno.test("a crew with members cannot be deleted, and the message points to the Users page", () => {
  const error = assertThrows(() => assertTeamDeletable("Crew A", 0, 1), ConflictError);
  assertEquals(error.message.includes("1 member."), true);
  assertEquals(error.message.includes("Users page"), true);
});

Deno.test("job history is reported before members when both apply", () => {
  const error = assertThrows(() => assertTeamDeletable("Crew A", 1, 2), ConflictError);
  assertEquals(error.message.includes("1 job "), true);
});
