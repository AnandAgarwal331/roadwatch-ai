"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ClipboardList } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { PageHeading } from "@/components/dashboard/dashboard-shell";
import { StatCard, StatGrid } from "@/components/dashboard/stat-card";
import { CardGridSkeleton, EmptyState, ErrorState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";
import { TaskCard } from "@/features/team/task-card";
import type { Task, TeamDashboard as TeamDashboardData } from "@/types";

export function TeamDashboard() {
  const query = useQuery({
    queryKey: ["team", "dashboard"],
    queryFn: () => api.get<TeamDashboardData>("/team/dashboard"),
  });

  if (query.isPending) {
    return (
      <>
        <PageHeading title="Today" />
        <CardGridSkeleton count={6} />
      </>
    );
  }

  if (query.isError) {
    return (
      <>
        <PageHeading title="Today" />
        <ErrorState
          title="Could not load your jobs"
          description={errorMessage(query.error)}
          onRetry={() => query.refetch()}
        />
      </>
    );
  }

  const { team, stats, critical, in_progress, today, completed_recently } = query.data;

  return (
    <>
      <PageHeading
        title={team.name}
        description={
          team.zone
            ? `${team.zone} - up to ${stats.capacity} jobs at a time.`
            : `Up to ${stats.capacity} jobs at a time.`
        }
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/team/tasks">All jobs</Link>
          </Button>
        }
      />

      <StatGrid className="mb-8">
        <StatCard label="Open jobs" value={stats.open_jobs} icon={ClipboardList} />
        <StatCard
          label="Critical open"
          value={stats.critical_open}
          icon={AlertTriangle}
          tone={stats.critical_open > 0 ? "critical" : "default"}
        />
        <StatCard
          label="Overdue"
          value={stats.overdue}
          icon={AlertTriangle}
          tone={stats.overdue > 0 ? "warning" : "default"}
        />
        <StatCard
          label="Completed all time"
          value={stats.completed_total}
          icon={CheckCircle2}
          tone="success"
        />
      </StatGrid>

      <div className="space-y-8">
        <TaskSection
          title="Critical"
          description="Do these first. A critical score means the hazard is on a busy road, near a hospital or school, or has been reported repeatedly."
          tasks={critical}
          emptyMessage="Nothing critical is open."
        />

        <TaskSection
          title="In progress"
          description="Jobs your crew has started but not yet submitted evidence for."
          tasks={in_progress}
          emptyMessage="No job is currently in progress."
        />

        <TaskSection
          title="Due today"
          description="Open jobs due by the end of today, plus any with no due date set."
          tasks={today}
          emptyMessage="Nothing is due today."
        />

        {completed_recently.length > 0 ? (
          <TaskSection
            title="Recently completed"
            description="Awaiting verification by the works department, or already verified."
            tasks={completed_recently}
            emptyMessage=""
          />
        ) : null}
      </div>
    </>
  );
}

function TaskSection({
  title,
  description,
  tasks,
  emptyMessage,
}: {
  title: string;
  description: string;
  tasks: Task[];
  emptyMessage: string;
}) {
  const headingId = React.useId();

  return (
    <section aria-labelledby={headingId}>
      <header className="mb-3">
        <h2 id={headingId} className="text-lg font-semibold tracking-tight">
          {title}
          <span className="ml-2 text-sm font-normal text-muted-foreground">{tasks.length}</span>
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </header>

      {tasks.length === 0 ? (
        <EmptyState title={emptyMessage} className="py-8" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} />
          ))}
        </div>
      )}
    </section>
  );
}
