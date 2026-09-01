"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Copy, Hammer, Inbox } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { PriorityBadge, StatusBadge } from "@/components/complaints/badges";
import { PageHeading } from "@/components/dashboard/dashboard-shell";
import {
  ChartCard,
  ChartEmpty,
  ChartTooltip,
  MARK,
  axisProps,
  useChartTheme,
} from "@/components/dashboard/chart-kit";
import { StatCard, StatGrid } from "@/components/dashboard/stat-card";
import { ErrorState, TableSkeleton } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";
import {
  PRIORITY_DISCLAIMER,
  PRIORITY_LABELS,
  PRIORITY_ORDER,
  STATUS_LABELS,
} from "@/lib/constants";
import { formatDuration, formatRate, timeAgo } from "@/lib/utils";
import type {
  ComplaintStatus,
  ComplaintSummary,
  DashboardResponse,
  PriorityLevel,
} from "@/types";

export function AdminDashboard() {
  const theme = useChartTheme();

  const query = useQuery({
    queryKey: ["admin", "dashboard"],
    queryFn: () => api.get<DashboardResponse>("/admin/dashboard"),
  });

  if (query.isPending) {
    return (
      <>
        <PageHeading title="Dashboard" />
        <TableSkeleton rows={8} />
      </>
    );
  }

  if (query.isError) {
    return (
      <>
        <PageHeading title="Dashboard" />
        <ErrorState
          title="Could not load the dashboard"
          description={errorMessage(query.error)}
          onRetry={() => query.refetch()}
        />
      </>
    );
  }

  const { kpis, priority_queue, recent_reports, status_distribution, priority_distribution } =
    query.data;

  // Priority is ordinal, so it gets the one-hue severity ramp in a fixed
  // low-to-critical order rather than four competing categorical hues.
  const priorityData = PRIORITY_ORDER.slice()
    .reverse()
    .map((level) => ({
      level,
      label: PRIORITY_LABELS[level],
      count: priority_distribution.find((item) => item.level === level)?.count ?? 0,
    }));

  // Status is a magnitude comparison and the category already sits on the
  // axis, so one hue carries it.
  const statusData = status_distribution
    .map((item) => ({
      status: item.status,
      label: STATUS_LABELS[item.status as ComplaintStatus] ?? item.status,
      count: item.count,
    }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count);

  return (
    <>
      <PageHeading
        title="Dashboard"
        description="What is waiting, what is urgent, and what has been reported lately."
        actions={
          <Button asChild size="sm">
            <Link href="/admin/reports">Open the queue</Link>
          </Button>
        }
      />

      <StatGrid className="mb-6">
        <StatCard
          label="Awaiting review"
          value={kpis.pending_review}
          icon={Inbox}
          href="/admin/reports?status=AWAITING_REVIEW"
          tone={kpis.pending_review > 0 ? "warning" : "default"}
        />
        {/* `kpis.critical` counts every report scored critical, resolved ones
            included, so this is not an open-work figure - the priority queue
            below is. Labelled for what it actually counts. */}
        <StatCard
          label="Critical"
          value={kpis.critical}
          hint="All time, including resolved"
          icon={AlertTriangle}
          tone={kpis.critical > 0 ? "critical" : "default"}
          href="/admin/reports?priority=CRITICAL"
        />
        <StatCard
          label="In progress"
          value={kpis.in_progress}
          icon={Hammer}
          href="/admin/reports?status=IN_PROGRESS"
        />
        <StatCard
          label="Resolved"
          value={kpis.resolved}
          icon={CheckCircle2}
          tone="success"
          hint={`${formatRate(kpis.resolution_rate)} of all reports`}
        />
      </StatGrid>

      <StatGrid className="mb-8 lg:grid-cols-4">
        <StatCard label="Reported this week" value={kpis.reports_last_7_days} />
        <StatCard label="Reported in 30 days" value={kpis.reports_last_30_days} />
        <StatCard
          label="Average time to resolve"
          value={formatDuration(kpis.average_resolution_hours)}
        />
        <StatCard
          label="Duplicates to review"
          value={kpis.pending_duplicates}
          icon={Copy}
          href="/admin/duplicates"
          tone={kpis.pending_duplicates > 0 ? "warning" : "default"}
        />
      </StatGrid>

      <div className="mb-8 grid gap-5 lg:grid-cols-2">
        <ChartCard
          title="Open reports by priority"
          description="Low to critical. One hue, because priority is a scale rather than a set of categories."
          table={{
            rows: priorityData,
            columns: [
              { key: "label", header: "Priority", cell: (row) => row.label },
              { key: "count", header: "Reports", numeric: true, cell: (row) => row.count },
            ],
          }}
        >
          {priorityData.every((item) => item.count === 0) ? (
            <ChartEmpty message="No reports scored yet." />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={priorityData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={theme.grid} vertical={false} />
                <XAxis dataKey="label" {...axisProps(theme)} />
                <YAxis allowDecimals={false} width={40} {...axisProps(theme)} />
                <Tooltip
                  cursor={{ fill: theme.grid, fillOpacity: 0.25 }}
                  content={<ChartTooltip />}
                />
                <Bar dataKey="count" name="Reports" barSize={MARK.barSize} radius={MARK.radiusY}>
                  {priorityData.map((item) => (
                    <Cell
                      key={item.level}
                      fill={theme.priority[item.level as PriorityLevel]}
                      stroke={theme.surface}
                      strokeWidth={MARK.gap}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard
          title="Reports by status"
          description="Where everything currently sits in the lifecycle."
          table={{
            rows: statusData,
            columns: [
              { key: "label", header: "Status", cell: (row) => row.label },
              { key: "count", header: "Reports", numeric: true, cell: (row) => row.count },
            ],
          }}
        >
          {statusData.length === 0 ? (
            <ChartEmpty message="No reports yet." />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart
                data={statusData}
                layout="vertical"
                margin={{ top: 8, right: 16, bottom: 0, left: 8 }}
              >
                <CartesianGrid stroke={theme.grid} horizontal={false} />
                <XAxis type="number" allowDecimals={false} {...axisProps(theme)} />
                <YAxis type="category" dataKey="label" width={110} {...axisProps(theme)} />
                <Tooltip
                  cursor={{ fill: theme.grid, fillOpacity: 0.25 }}
                  content={<ChartTooltip />}
                />
                <Bar
                  dataKey="count"
                  name="Reports"
                  fill={theme.sequential}
                  barSize={MARK.barSize}
                  radius={MARK.radiusX}
                  stroke={theme.surface}
                  strokeWidth={MARK.gap}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <QueueList
          title="Priority queue"
          description="Open reports, highest score first. This is the order to work in."
          reports={priority_queue}
          showScore
        />
        <QueueList
          title="Just reported"
          description="The most recent submissions, whatever their score."
          reports={recent_reports}
        />
      </div>

      <p className="mt-6 text-xs text-muted-foreground">{PRIORITY_DISCLAIMER}</p>
    </>
  );
}

function QueueList({
  title,
  description,
  reports,
  showScore,
}: {
  title: string;
  description: string;
  reports: ComplaintSummary[];
  showScore?: boolean;
}) {
  const headingId = React.useId();

  return (
    <section aria-labelledby={headingId} className="rounded-xl border border-border bg-card">
      <header className="border-b border-border p-4">
        <h2 id={headingId} className="text-sm font-semibold">
          {title}
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </header>

      {reports.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">Nothing to show.</p>
      ) : (
        <ul className="divide-y divide-border">
          {reports.map((report) => (
            <li key={report.id}>
              <Link
                href={`/admin/reports/${report.id}`}
                className="flex items-start gap-3 p-4 transition-colors hover:bg-muted/50 focus:bg-muted/50 focus:outline-none"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {showScore ? (
                      <PriorityBadge level={report.priority_level} score={report.priority_score} />
                    ) : (
                      <PriorityBadge level={report.priority_level} />
                    )}
                    <StatusBadge status={report.status} />
                  </div>

                  <p className="mt-1.5 truncate text-sm font-medium">
                    {report.road_name ?? "Unnamed road"}
                  </p>
                  <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                    {report.description ?? "No description provided."}
                  </p>
                </div>

                <div className="shrink-0 text-right">
                  <p className="font-mono text-[11px] text-muted-foreground">
                    {report.complaint_number}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {timeAgo(report.created_at)}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
