"use client";

import { useQuery } from "@tanstack/react-query";
import * as React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { PageHeading } from "@/components/dashboard/dashboard-shell";
import {
  ChartCard,
  ChartEmpty,
  ChartTable,
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
  DAMAGE_TYPE_LABELS,
  PRIORITY_DISCLAIMER,
  PRIORITY_LABELS,
  PRIORITY_ORDER,
} from "@/lib/constants";
import { formatDistance, formatDuration, formatRate } from "@/lib/utils";
import type { AnalyticsResponse, DamageType, PriorityLevel } from "@/types";

const RANGES = [
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: 180, label: "6 months" },
  { value: 365, label: "12 months" },
];

/** Only the top slice is plotted; the rest stays readable in the table. */
const TOP_N = 8;

export function AnalyticsView() {
  const theme = useChartTheme();
  const [days, setDays] = React.useState(30);

  const query = useQuery({
    queryKey: ["admin", "analytics", days],
    queryFn: () => api.get<AnalyticsResponse>("/admin/analytics", { days }),
  });

  if (query.isPending) {
    return (
      <>
        <PageHeading title="Analytics" />
        <TableSkeleton rows={8} />
      </>
    );
  }

  if (query.isError) {
    return (
      <>
        <PageHeading title="Analytics" />
        <ErrorState
          title="Could not load analytics"
          description={errorMessage(query.error)}
          onRetry={() => query.refetch()}
        />
      </>
    );
  }

  const data = query.data;

  // Three real series, so this is the one genuinely categorical chart here.
  const timeSeries = data.reports_over_time.map((row) => ({
    ...row,
    label: new Date(row.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
  }));
  const timeLegend = [
    { label: "Reported", color: theme.series[0] },
    { label: "Resolved", color: theme.series[1] },
    { label: "Critical", color: theme.series[2] },
  ];

  const damageData = data.by_damage_type
    .map((row) => ({
      ...row,
      label: DAMAGE_TYPE_LABELS[row.damage_type as DamageType] ?? row.damage_type,
    }))
    .sort((a, b) => b.count - a.count);

  const areaData = data.by_area.slice().sort((a, b) => b.count - a.count);

  const resolutionData = PRIORITY_ORDER.slice()
    .reverse()
    .map((level) => {
      const row = data.resolution_by_priority.find((item) => item.level === level);
      return {
        level,
        label: PRIORITY_LABELS[level],
        hours: row?.average_hours ?? 0,
        resolved: row?.resolved_count ?? 0,
      };
    });

  return (
    <>
      <PageHeading
        title="Analytics"
        description="How reporting and repair are trending across the city."
        actions={
          <div className="flex flex-wrap gap-1" role="group" aria-label="Time range">
            {RANGES.map((range) => (
              <Button
                key={range.value}
                variant={days === range.value ? "default" : "outline"}
                size="sm"
                aria-pressed={days === range.value}
                onClick={() => setDays(range.value)}
              >
                {range.label}
              </Button>
            ))}
          </div>
        }
      />

      <StatGrid className="mb-8">
        <StatCard label="Total reports" value={data.kpis.total_reports} />
        <StatCard
          label="Resolution rate"
          value={formatRate(data.kpis.resolution_rate)}
          tone="success"
        />
        <StatCard
          label="Average time to resolve"
          value={formatDuration(data.kpis.average_resolution_hours)}
        />
        <StatCard
          label="Still unresolved"
          value={data.kpis.unresolved}
          tone={data.kpis.unresolved > 0 ? "warning" : "default"}
        />
      </StatGrid>

      <div className="space-y-6">
        <ChartCard
          title="Reports and repairs over time"
          description={`Daily counts across the last ${days} days.`}
          legend={timeLegend}
          table={{
            rows: timeSeries,
            columns: [
              { key: "label", header: "Date", cell: (row) => row.label },
              { key: "reported", header: "Reported", numeric: true, cell: (row) => row.reported },
              { key: "resolved", header: "Resolved", numeric: true, cell: (row) => row.resolved },
              { key: "critical", header: "Critical", numeric: true, cell: (row) => row.critical },
            ],
          }}
        >
          {timeSeries.length === 0 ? (
            <ChartEmpty />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={timeSeries} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={theme.grid} vertical={false} />
                <XAxis dataKey="label" minTickGap={24} {...axisProps(theme)} />
                <YAxis allowDecimals={false} width={40} {...axisProps(theme)} />
                <Tooltip
                  cursor={{ stroke: theme.axis, strokeWidth: 1 }}
                  content={<ChartTooltip />}
                />
                <Line
                  type="monotone"
                  dataKey="reported"
                  name="Reported"
                  stroke={theme.series[0]}
                  strokeWidth={MARK.lineWidth}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  dot={false}
                  activeDot={{ r: MARK.dotRadius, stroke: theme.surface, strokeWidth: MARK.gap }}
                />
                <Line
                  type="monotone"
                  dataKey="resolved"
                  name="Resolved"
                  stroke={theme.series[1]}
                  strokeWidth={MARK.lineWidth}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  dot={false}
                  activeDot={{ r: MARK.dotRadius, stroke: theme.surface, strokeWidth: MARK.gap }}
                />
                <Line
                  type="monotone"
                  dataKey="critical"
                  name="Critical"
                  stroke={theme.series[2]}
                  strokeWidth={MARK.lineWidth}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  dot={false}
                  activeDot={{ r: MARK.dotRadius, stroke: theme.surface, strokeWidth: MARK.gap }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <div className="grid gap-6 lg:grid-cols-2">
          <ChartCard
            title="What is being reported"
            description="Damage types by volume. One hue, because the category is already on the axis."
            table={{
              rows: damageData,
              columns: [
                { key: "label", header: "Damage type", cell: (row) => row.label },
                { key: "count", header: "Reports", numeric: true, cell: (row) => row.count },
              ],
            }}
          >
            {damageData.length === 0 ? (
              <ChartEmpty />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={damageData}
                  layout="vertical"
                  margin={{ top: 8, right: 16, bottom: 0, left: 8 }}
                >
                  <CartesianGrid stroke={theme.grid} horizontal={false} />
                  <XAxis type="number" allowDecimals={false} {...axisProps(theme)} />
                  <YAxis type="category" dataKey="label" width={130} {...axisProps(theme)} />
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

          <ChartCard
            title="Time to resolve by priority"
            description="Average hours from report to verified repair. The ramp runs low to critical."
            table={{
              rows: resolutionData,
              columns: [
                { key: "label", header: "Priority", cell: (row) => row.label },
                {
                  key: "hours",
                  header: "Average",
                  numeric: true,
                  cell: (row) => (row.hours ? formatDuration(row.hours) : "-"),
                },
                { key: "resolved", header: "Resolved", numeric: true, cell: (row) => row.resolved },
              ],
            }}
          >
            {resolutionData.every((row) => row.hours === 0) ? (
              <ChartEmpty message="Nothing has been resolved yet." />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={resolutionData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={theme.grid} vertical={false} />
                  <XAxis dataKey="label" {...axisProps(theme)} />
                  <YAxis width={48} {...axisProps(theme)} />
                  <Tooltip
                    cursor={{ fill: theme.grid, fillOpacity: 0.25 }}
                    content={
                      <ChartTooltip formatter={(value) => formatDuration(Number(value))} />
                    }
                  />
                  <Bar
                    dataKey="hours"
                    name="Average hours"
                    barSize={MARK.barSize}
                    radius={MARK.radiusY}
                  >
                    {resolutionData.map((row) => (
                      <Cell
                        key={row.level}
                        fill={theme.priority[row.level as PriorityLevel]}
                        stroke={theme.surface}
                        strokeWidth={MARK.gap}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </div>

        <ChartCard
          title="Where problems are reported"
          description={`Areas by report volume. The chart shows the top ${TOP_N}; the table has them all.`}
          table={{
            rows: areaData,
            columns: [
              { key: "area", header: "Area", cell: (row) => row.area },
              { key: "count", header: "Reports", numeric: true, cell: (row) => row.count },
              {
                key: "average_priority",
                header: "Average priority",
                numeric: true,
                cell: (row) => row.average_priority.toFixed(1),
              },
            ],
          }}
        >
          {areaData.length === 0 ? (
            <ChartEmpty />
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(220, areaData.slice(0, TOP_N).length * 38)}>
              <BarChart
                data={areaData.slice(0, TOP_N)}
                layout="vertical"
                margin={{ top: 8, right: 16, bottom: 0, left: 8 }}
              >
                <CartesianGrid stroke={theme.grid} horizontal={false} />
                <XAxis type="number" allowDecimals={false} {...axisProps(theme)} />
                <YAxis type="category" dataKey="area" width={150} {...axisProps(theme)} />
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

        <div className="grid gap-6 xl:grid-cols-2">
          <Panel
            title="Worst roads"
            description="Ranked by how many reports each road has attracted."
            empty={data.top_roads.length === 0}
          >
            <ChartTable
              caption="Roads by report count"
              rows={data.top_roads}
              columns={[
                { key: "road", header: "Road", cell: (row) => row.road_name },
                { key: "count", header: "Reports", numeric: true, cell: (row) => row.count },
                {
                  key: "avg",
                  header: "Average priority",
                  numeric: true,
                  cell: (row) => row.average_priority.toFixed(1),
                },
                {
                  key: "max",
                  header: "Worst",
                  numeric: true,
                  cell: (row) => row.max_priority.toFixed(1),
                },
              ]}
            />
          </Panel>

          <Panel
            title="Repeat locations"
            description="Spots reported more than once, which usually means the last repair did not hold."
            empty={data.repeat_locations.length === 0}
          >
            <ChartTable
              caption="Locations with repeated reports"
              rows={data.repeat_locations}
              columns={[
                {
                  key: "road",
                  header: "Location",
                  cell: (row) => row.road_name ?? "Unnamed road",
                },
                {
                  key: "count",
                  header: "Reports",
                  numeric: true,
                  cell: (row) => row.report_count,
                },
                {
                  key: "unresolved",
                  header: "Open",
                  numeric: true,
                  cell: (row) => row.unresolved,
                },
                {
                  key: "spread",
                  header: "Spread",
                  numeric: true,
                  cell: (row) => formatDistance(row.spread_meters),
                },
              ]}
            />
          </Panel>
        </div>

        <Panel
          title="Crew performance"
          description="Workload and turnaround by repair crew."
          empty={data.team_performance.length === 0}
        >
          <ChartTable
            caption="Performance by repair crew"
            rows={data.team_performance}
            columns={[
              { key: "team", header: "Crew", cell: (row) => row.team_name },
              { key: "zone", header: "Zone", cell: (row) => row.zone ?? "-" },
              {
                key: "open",
                header: "Open",
                numeric: true,
                cell: (row) => `${row.open_jobs}/${row.capacity}`,
              },
              { key: "completed", header: "Completed", numeric: true, cell: (row) => row.completed },
              {
                key: "avg",
                header: "Average job",
                numeric: true,
                cell: (row) => formatDuration(row.average_completion_hours),
              },
              {
                key: "ontime",
                header: "On time",
                numeric: true,
                // formatRate renders null as a dash: "no completed jobs
                // yet" is not the same as "0% on time".
                cell: (row) => formatRate(row.on_time_rate),
              },
            ]}
          />
        </Panel>
      </div>

      <p className="mt-6 text-xs text-muted-foreground">{PRIORITY_DISCLAIMER}</p>
    </>
  );
}

function Panel({
  title,
  description,
  empty,
  children,
}: {
  title: string;
  description: string;
  empty: boolean;
  children: React.ReactNode;
}) {
  const headingId = React.useId();

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-xl border border-border bg-card p-4 shadow-card sm:p-5"
    >
      <header className="mb-4">
        <h3 id={headingId} className="text-sm font-semibold">
          {title}
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </header>

      {empty ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Nothing to show yet.</p>
      ) : (
        children
      )}
    </section>
  );
}
