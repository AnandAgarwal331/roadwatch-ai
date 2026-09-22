"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import * as React from "react";

import { IssueMapView } from "@/components/map/map-view";
import { PageHeading } from "@/components/dashboard/dashboard-shell";
import { ErrorState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api, errorMessage } from "@/lib/api";
import { PRIORITY_HEX, PRIORITY_LABELS, PRIORITY_ORDER } from "@/lib/constants";
import { taskToMapIssue } from "@/features/team/task-to-map-issue";
import type { MapIssue, PriorityLevel, Task } from "@/types";

const EMPTY_TASKS: Task[] = [];

/**
 * Every job assigned to the crew, on a map, coloured by priority - the same
 * marker/popup component the public and admin maps use, but built from
 * `GET /team/tasks` instead of the shared `/map/issues` endpoint so each
 * marker's "View" link lands on `/team/tasks/{assignment id}`, not a
 * complaint id that 404s there. See task-to-map-issue.ts.
 */
export function TeamMap() {
  const [openOnly, setOpenOnly] = React.useState(true);

  const query = useQuery({
    queryKey: ["team", "tasks", "map", openOnly],
    queryFn: () =>
      api.get<Task[]>("/team/tasks", {
        status_filter: openOnly ? ["ASSIGNED", "IN_PROGRESS"] : undefined,
      }),
  });

  const tasks = query.data ?? EMPTY_TASKS;
  const issues = React.useMemo<MapIssue[]>(
    () => tasks.filter((task) => Number.isFinite(task.complaint.latitude) && Number.isFinite(task.complaint.longitude)).map(taskToMapIssue),
    [tasks],
  );

  const counts = React.useMemo(() => {
    const result: Record<PriorityLevel, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    for (const issue of issues) result[issue.priority_level] += 1;
    return result;
  }, [issues]);

  return (
    <>
      <PageHeading
        title="Map"
        description="Every job assigned to your crew. Click a marker for the job, or open it to navigate there."
      />

      <div className="mb-4 flex items-center justify-between gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={openOnly}
            onChange={(event) => setOpenOnly(event.target.checked)}
            className="h-4 w-4 rounded border-input accent-[hsl(var(--primary))]"
          />
          Open jobs only
        </label>

        <Button asChild variant="outline" size="sm">
          <Link href="/team/tasks">List view</Link>
        </Button>
      </div>

      {query.isError ? (
        <ErrorState
          title="Could not load your jobs"
          description={errorMessage(query.error)}
          onRetry={() => query.refetch()}
        />
      ) : (
        <>
          <Card className="overflow-hidden p-0">
            <div className="h-[560px] w-full">
              <IssueMapView
                issues={issues}
                detailBasePath="/team/tasks"
                fitToIssues={issues.length > 0}
              />
            </div>
          </Card>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
            <ul className="flex flex-wrap items-center gap-4">
              {PRIORITY_ORDER.map((level) => (
                <li key={level} className="flex items-center gap-2 text-sm">
                  <span
                    className="h-3 w-3 rounded-full border-2 border-card"
                    style={{ backgroundColor: PRIORITY_HEX[level] }}
                    aria-hidden="true"
                  />
                  <span className="text-muted-foreground">
                    {PRIORITY_LABELS[level]}
                    <span className="ml-1.5 font-medium tabular-nums text-foreground">{counts[level]}</span>
                  </span>
                </li>
              ))}
            </ul>

            <p className="text-sm text-muted-foreground" aria-live="polite">
              {query.isPending
                ? "Loading..."
                : query.isFetching
                  ? "Updating..."
                  : `${issues.length} job${issues.length === 1 ? "" : "s"} shown`}
            </p>
          </div>
        </>
      )}
    </>
  );
}
