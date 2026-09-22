import type { MapIssue, Task } from "@/types";

/**
 * A crew's job as a map marker, keyed by the *assignment* id rather than the
 * complaint id `GET /map/issues` would normally use.
 *
 * The crew map is built from `GET /team/tasks`, not the shared `/map/issues`
 * endpoint, specifically so this can use the assignment id: the crew's job
 * page lives at `/team/tasks/{assignment id}`, a different id from the
 * complaint's own, and a marker built from the wrong one 404s the moment it's
 * clicked (the same mismatch fixed in the "new assignment" notification -
 * see `notifications.complaintAssigned`).
 */
export function taskToMapIssue(task: Task): MapIssue {
  const { complaint } = task;
  return {
    id: task.id,
    complaint_number: complaint.complaint_number,
    latitude: complaint.latitude,
    longitude: complaint.longitude,
    damage_type: complaint.damage_type,
    status: complaint.status,
    priority_level: complaint.priority_level,
    priority_score: complaint.priority_score,
    severity_score: complaint.severity_score,
    report_count: complaint.report_count,
    road_name: complaint.road_name,
    created_at: complaint.created_at,
  };
}
