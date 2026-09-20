// Regression coverage for the pagination shape bug: the ported list routes
// once returned { items, total, total_pages } instead of the nested
// { items, meta: { total, pages, has_next, has_previous, ... } } shape the
// frontend's Paginated<T> type expects, which crashed My Reports/the admin
// queue/the public reports browser right after sign-in. See
// routes/complaints.ts and routes/admin.ts for the callers.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { paginated, toDuplicateCandidate, toMapIssue, toSummary, nextStep } from "./serializers.ts";

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
