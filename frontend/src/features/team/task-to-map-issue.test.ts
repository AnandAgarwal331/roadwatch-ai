import { describe, expect, it } from "vitest";

import type { Task } from "@/types";

import { taskToMapIssue } from "./task-to-map-issue";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "assignment-1",
    status: "ASSIGNED",
    due_at: null,
    started_at: null,
    completed_at: null,
    verified_at: null,
    notes: null,
    created_at: "2026-01-01T00:00:00Z",
    evidence: [],
    is_overdue: false,
    repair_details: null,
    rework_count: 0,
    rework_reason: null,
    reworked_at: null,
    flag_reason: null,
    flagged_at: null,
    is_emergency: false,
    emergency_reason: null,
    escalated_at: null,
    complaint: {
      id: "complaint-1",
      complaint_number: "RW-2026-000001",
      damage_type: "POTHOLE",
      status: "ASSIGNED",
      priority_score: 82,
      priority_level: "HIGH",
      severity_score: 7,
      report_count: 3,
      latitude: 12.9,
      longitude: 77.6,
      road_name: "MG Road",
      description: "A pothole",
      thumbnail_url: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
    ...overrides,
  };
}

describe("taskToMapIssue", () => {
  it("uses the assignment's own id, not the complaint's", () => {
    // The whole point of this function: /team/tasks/{id} needs the
    // assignment id. Using complaint.id here would 404 every marker click.
    const issue = taskToMapIssue(task());
    expect(issue.id).toBe("assignment-1");
    expect(issue.id).not.toBe(task().complaint.id);
  });

  it("carries the fields a map marker and its popup need", () => {
    const issue = taskToMapIssue(task());
    expect(issue).toEqual({
      id: "assignment-1",
      complaint_number: "RW-2026-000001",
      latitude: 12.9,
      longitude: 77.6,
      damage_type: "POTHOLE",
      status: "ASSIGNED",
      priority_level: "HIGH",
      priority_score: 82,
      severity_score: 7,
      report_count: 3,
      road_name: "MG Road",
      created_at: "2026-01-01T00:00:00Z",
    });
  });

  it("reads location and priority from the complaint, which can change independently of the job", () => {
    const issue = taskToMapIssue(
      task({ complaint: { ...task().complaint, latitude: 1, longitude: 2, priority_score: 40, priority_level: "MEDIUM" } }),
    );
    expect(issue.latitude).toBe(1);
    expect(issue.longitude).toBe(2);
    expect(issue.priority_score).toBe(40);
    expect(issue.priority_level).toBe("MEDIUM");
  });
});
