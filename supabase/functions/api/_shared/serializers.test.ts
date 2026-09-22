// Regression coverage for the pagination shape bug: the ported list routes
// once returned { items, total, total_pages } instead of the nested
// { items, meta: { total, pages, has_next, has_previous, ... } } shape the
// frontend's Paginated<T> type expects, which crashed My Reports/the admin
// queue/the public reports browser right after sign-in. See
// routes/complaints.ts and routes/admin.ts for the callers.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { activeAssignment, paginated, toDuplicateCandidate, toMapIssue, toSummary, toTask, toTaskDetail, nextStep } from "./serializers.ts";

Deno.test("paginated() nests fields under meta with the frontend's exact field names", () => {
  const result = paginated(["a", "b"], 42, 2, 20);
  assertEquals(result.items, ["a", "b"]);
  assertEquals(result.meta, {
    total: 42,
    page: 2,
    page_size: 20,
    pages: 3,
    has_next: true,
    has_previous: true,
  });
});

Deno.test("paginated() has_next/has_previous at the boundaries", () => {
  const firstPage = paginated([], 5, 1, 20);
  assertEquals(firstPage.meta.has_previous, false);
  assertEquals(firstPage.meta.has_next, false); // only page, 5 items fit in page_size 20

  const lastOfMany = paginated([], 41, 3, 20);
  assertEquals(lastOfMany.meta.pages, 3);
  assertEquals(lastOfMany.meta.has_next, false);
  assertEquals(lastOfMany.meta.has_previous, true);
});

Deno.test("paginated() with zero results still reports one page, not zero", () => {
  const result = paginated([], 0, 1, 20);
  // Math.ceil(0/20) is 0, which would make "page 1 of 0" nonsensical in the UI.
  assertEquals(result.meta.pages, 1);
  assertEquals(result.meta.has_next, false);
  assertEquals(result.meta.has_previous, false);
});

function complaint(overrides: Record<string, unknown> = {}) {
  return {
    id: "c1",
    complaint_number: "RW-2026-000001",
    damage_type: "POTHOLE",
    status: "PENDING",
    priority_score: 0,
    priority_level: null,
    severity_score: null,
    report_count: 1,
    latitude: 12.9,
    longitude: 77.6,
    road_name: "MG Road",
    description: "A pothole",
    images: [],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

Deno.test("toSummary() picks the REPORT-kind image as the thumbnail", () => {
  const row = complaint({
    images: [
      { kind: "BEFORE", url: "https://example.com/before.jpg" },
      { kind: "REPORT", url: "https://example.com/report.jpg" },
    ],
  });
  assertEquals(toSummary(row).thumbnail_url, "https://example.com/report.jpg");
});

Deno.test("toSummary() falls back to the first image when there is no REPORT kind", () => {
  const row = complaint({ images: [{ kind: "AFTER", url: "https://example.com/after.jpg" }] });
  assertEquals(toSummary(row).thumbnail_url, "https://example.com/after.jpg");
});

Deno.test("toSummary() thumbnail is null with no images", () => {
  assertEquals(toSummary(complaint({ images: [] })).thumbnail_url, null);
});

Deno.test("toMapIssue() carries only map-relevant fields", () => {
  const row = complaint({ description: "sensitive text", reporter_id: "u1" });
  const issue = toMapIssue(row);
  assertEquals(issue.id, "c1");
  assertEquals("description" in issue, false);
  assertEquals("reporter_id" in issue, false);
});

Deno.test("toDuplicateCandidate() maps a candidate onto the wire shape", () => {
  const candidate = {
    complaint: complaint({ id: "c2", status: "PRIORITIZED" }),
    similarity: 0.812345,
    distanceMeters: 12.4,
    reason: "This may be the same road issue.",
    // deno-lint-ignore no-explicit-any
  } as any;
  const out = toDuplicateCandidate(candidate);
  assertEquals(out.complaint_id, "c2");
  assertEquals(out.similarity, 0.812345);
  assertEquals(out.distance_meters, 12.4);
  assertEquals(out.status, "PRIORITIZED");
});

Deno.test("nextStep() flags manual review ahead of priority level", () => {
  const message = nextStep(complaint({ priority_level: "CRITICAL" }), true);
  assertEquals(message.includes("manually"), true);
});

Deno.test("nextStep() calls out critical priority when review isn't needed", () => {
  const message = nextStep(complaint({ priority_level: "CRITICAL" }), false);
  assertEquals(message.includes("critical"), true);
});

Deno.test("nextStep() gives the generic queue message otherwise", () => {
  const message = nextStep(complaint({ priority_level: "LOW" }), false);
  assertEquals(message.includes("prioritisation queue"), true);
});

// activeAssignment() is what puts "Awaiting verification" in front of an
// admin: toDetail's `assignment` field and admin.ts's toAdminSummary's
// `assignment_status` both come from it, and both treat COMPLETED (a crew
// has finished but nobody has approved it yet) as the "active" one an admin
// still needs to act on - same as ASSIGNED or IN_PROGRESS.
function assignment(overrides: Record<string, unknown> = {}) {
  return {
    id: "a1",
    status: "ASSIGNED",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

Deno.test("activeAssignment() treats a completed-but-unverified repair as active", () => {
  const found = activeAssignment([assignment({ status: "COMPLETED" })]);
  assertEquals(found?.status, "COMPLETED");
});

Deno.test("activeAssignment() finds the assigned or in-progress one too", () => {
  assertEquals(activeAssignment([assignment({ status: "ASSIGNED" })])?.status, "ASSIGNED");
  assertEquals(activeAssignment([assignment({ status: "IN_PROGRESS" })])?.status, "IN_PROGRESS");
});

Deno.test("activeAssignment() is null once the repair has been verified", () => {
  assertEquals(activeAssignment([assignment({ status: "VERIFIED" })]), null);
});

Deno.test("activeAssignment() is null for a cancelled assignment, and for no assignment at all", () => {
  assertEquals(activeAssignment([assignment({ status: "CANCELLED" })]), null);
  assertEquals(activeAssignment([]), null);
  assertEquals(activeAssignment(null), null);
  assertEquals(activeAssignment(undefined), null);
});

Deno.test("activeAssignment() picks the most recent one when a report has been reassigned before", () => {
  const cancelled = assignment({ id: "old", status: "CANCELLED", created_at: "2026-01-01T00:00:00Z" });
  const current = assignment({ id: "new", status: "COMPLETED", created_at: "2026-01-05T00:00:00Z" });
  // Order in the array must not matter - this mirrors how PostgREST can
  // return embedded rows in either order.
  assertEquals(activeAssignment([cancelled, current])?.id, "new");
  assertEquals(activeAssignment([current, cancelled])?.id, "new");
});

// toTask() / toTaskDetail() - the crew's view of a job. A plain object
// literal stands in for a repair_assignments row here (not the assignment()
// factory above, which models one entry of an *embedded list* of
// assignments, a different shape).
function taskRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "a1",
    status: "IN_PROGRESS",
    due_at: null,
    started_at: "2026-01-02T00:00:00Z",
    completed_at: null,
    verified_at: null,
    notes: null,
    created_at: "2026-01-01T00:00:00Z",
    complaint: complaint(),
    evidence: [],
    ...overrides,
  };
}

Deno.test("toTask() defaults every crew-workflow field for a job that has none of this history", () => {
  const task = toTask(taskRow());
  assertEquals(task.repair_details, null);
  assertEquals(task.rework_count, 0);
  assertEquals(task.rework_reason, null);
  assertEquals(task.flag_reason, null);
  assertEquals(task.is_emergency, false);
  assertEquals(task.emergency_reason, null);
});

Deno.test("toTask() carries rework and emergency state through for the list views", () => {
  const task = toTask(
    taskRow({ rework_count: 2, rework_reason: "Surface still uneven", is_emergency: true, emergency_reason: "Exposed manhole" }),
  );
  assertEquals(task.rework_count, 2);
  assertEquals(task.rework_reason, "Surface still uneven");
  assertEquals(task.is_emergency, true);
  assertEquals(task.emergency_reason, "Exposed manhole");
});

Deno.test("toTask() coerces is_emergency to a real boolean, not whatever the database sent", () => {
  assertEquals(toTask(taskRow({ is_emergency: null })).is_emergency, false);
  assertEquals(toTask(taskRow({ is_emergency: undefined })).is_emergency, false);
});

Deno.test("toTaskDetail() gives the crew the full AI picture, not just the summary toTask() uses", () => {
  const detail = toTaskDetail(taskRow({ complaint: complaint({ priority_level: "HIGH" }) }));
  const complaintOut = detail.complaint as Record<string, unknown>;
  // toSummary() (what toTask() uses) has none of these - toDetail() does.
  assertEquals("priority" in complaintOut, true);
  assertEquals("traffic" in complaintOut, true);
  assertEquals("nearby_places" in complaintOut, true);
});

Deno.test("toTaskDetail() never exposes the reporter's identity to the crew", () => {
  const withReporter = complaint({ reporter: { id: "u1", full_name: "A Citizen", email: "citizen@example.com" } });
  const detail = toTaskDetail(taskRow({ complaint: withReporter }));
  assertEquals((detail.complaint as Record<string, unknown>).reporter, null);
});

Deno.test("toTaskDetail() keeps every field toTask() carries at the top level (evidence, rework, emergency, ...)", () => {
  const detail = toTaskDetail(taskRow({ rework_count: 1, is_emergency: true }));
  assertEquals(detail.rework_count, 1);
  assertEquals(detail.is_emergency, true);
  assertEquals(detail.id, "a1");
});
