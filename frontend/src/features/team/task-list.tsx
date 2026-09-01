"use client";

import { useQuery } from "@tanstack/react-query";
import { ClipboardList } from "lucide-react";
import * as React from "react";

import { PageHeading } from "@/components/dashboard/dashboard-shell";
import { CardGridSkeleton, EmptyState, ErrorState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";
import { TaskCard } from "@/features/team/task-card";
import { ASSIGNMENT_STATUS_LABELS } from "@/lib/constants";
import type { AssignmentStatus, Task } from "@/types";

/** Open first, then the closed states - the order a crew scans in. */
const TABS: { value: string; label: string; statuses?: AssignmentStatus[] }[] = [
  { value: "open", label: "Open", statuses: ["ASSIGNED", "IN_PROGRESS"] },
  { value: "ASSIGNED", label: ASSIGNMENT_STATUS_LABELS.ASSIGNED, statuses: ["ASSIGNED"] },
  { value: "IN_PROGRESS", label: ASSIGNMENT_STATUS_LABELS.IN_PROGRESS, statuses: ["IN_PROGRESS"] },
  { value: "COMPLETED", label: ASSIGNMENT_STATUS_LABELS.COMPLETED, statuses: ["COMPLETED"] },
  { value: "VERIFIED", label: ASSIGNMENT_STATUS_LABELS.VERIFIED, statuses: ["VERIFIED"] },
  { value: "all", label: "All" },
];

export function TaskList() {
  const [tab, setTab] = React.useState("open");

  const active = TABS.find((item) => item.value === tab) ?? TABS[0];

  const query = useQuery({
    queryKey: ["team", "tasks", tab],
    queryFn: () =>
      api.get<Task[]>("/team/tasks", {
        status_filter: active.statuses,
      }),
  });

  return (
    <>
      <PageHeading
        title="All jobs"
        description="Every job assigned to your crew, newest first."
      />

      <div className="mb-6 flex flex-wrap gap-2" role="tablist" aria-label="Filter jobs by status">
        {TABS.map((item) => (
          <Button
            key={item.value}
            role="tab"
            aria-selected={tab === item.value}
            variant={tab === item.value ? "default" : "outline"}
            size="sm"
            onClick={() => setTab(item.value)}
          >
            {item.label}
          </Button>
        ))}
      </div>

      {query.isPending ? (
        <CardGridSkeleton count={6} />
      ) : query.isError ? (
        <ErrorState
          title="Could not load your jobs"
          description={errorMessage(query.error)}
          onRetry={() => query.refetch()}
        />
      ) : query.data.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No jobs here"
          description="Nothing assigned to your crew matches this filter."
        />
      ) : (
        <>
          <p className="mb-4 text-sm text-muted-foreground" aria-live="polite">
            {query.data.length} job{query.data.length === 1 ? "" : "s"}
          </p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {query.data.map((task) => (
              <TaskCard key={task.id} task={task} />
            ))}
          </div>
        </>
      )}
    </>
  );
}
