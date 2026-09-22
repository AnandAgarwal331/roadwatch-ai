"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Search, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { DamageTypeBadge, PriorityBadge, RepairStatusBadge, StatusBadge } from "@/components/complaints/badges";
import { PageHeading } from "@/components/dashboard/dashboard-shell";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, errorMessage } from "@/lib/api";
import {
  DAMAGE_TYPE_LABELS,
  PRIORITY_DISCLAIMER,
  PRIORITY_LABELS,
  PRIORITY_ORDER,
  REPORTABLE_DAMAGE_TYPES,
  STATUS_LABELS,
} from "@/lib/constants";
import { timeAgo } from "@/lib/utils";
import type { ComplaintStatus, ComplaintSummary, Paginated } from "@/types";

const ANY = "ANY";
const PAGE_SIZE = 20;

const ALL_STATUSES: ComplaintStatus[] = [
  "PENDING",
  "AI_ANALYZED",
  "PRIORITIZED",
  "ASSIGNED",
  "IN_PROGRESS",
  "RESOLVED",
  "REJECTED",
  "DUPLICATE",
];

/**
 * "Awaiting review" is one number on the dashboard but three statuses in the
 * data: a report is waiting for a human whether it is still queued, already
 * analysed, or scored but unassigned. Selecting it here sends all three, so the
 * queue shows exactly the reports the tile counted.
 */
const AWAITING_REVIEW = "AWAITING_REVIEW";
const AWAITING_REVIEW_STATUSES: ComplaintStatus[] = ["PENDING", "AI_ANALYZED", "PRIORITIZED"];

/**
 * A repair the crew has marked done, waiting on an admin to approve it.
 * Not a report `status` at all - the report itself stays IN_PROGRESS for the
 * whole repair - so unlike AWAITING_REVIEW this maps to its own query
 * parameter (`awaiting_verification`) rather than a set of statuses.
 */
const AWAITING_VERIFICATION = "AWAITING_VERIFICATION";

/** Same shape as AWAITING_VERIFICATION: a report whose active repair has passed its due date, not a status of its own. */
const OVERDUE = "OVERDUE";

/** The `status` query value for a filter selection. */
function statusParam(value: string): ComplaintStatus[] | string | undefined {
  if (value === ANY || value === AWAITING_VERIFICATION || value === OVERDUE) return undefined;
  if (value === AWAITING_REVIEW) return AWAITING_REVIEW_STATUSES;
  return value;
}

const SORT_OPTIONS = [
  { value: "priority_score:desc", label: "Highest priority" },
  { value: "created_at:desc", label: "Newest first" },
  { value: "created_at:asc", label: "Oldest first" },
  { value: "report_count:desc", label: "Most reported" },
];

export function ReportQueue() {
  const router = useRouter();
  const params = useSearchParams();

  // The dashboard tiles link in with a filter already applied, so the initial
  // state is read from the URL rather than hard-coded. awaiting_verification
  // and overdue are each their own query parameter (see their own comments),
  // so they are folded back into the one status dropdown here.
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [status, setStatus] = React.useState<string>(
    params.get("awaiting_verification") === "true"
      ? AWAITING_VERIFICATION
      : params.get("overdue") === "true"
        ? OVERDUE
        : (params.get("status") ?? ANY),
  );
  const [priority, setPriority] = React.useState<string>(params.get("priority") ?? ANY);
  const [damageType, setDamageType] = React.useState<string>(ANY);
  const [sort, setSort] = React.useState<string>("priority_score:desc");
  const [page, setPage] = React.useState(1);
  // A deep link only (from a user's "Reports" button) - not a control anyone
  // picks from a dropdown, so it has no UI of its own here beyond the chip
  // that shows it is active and lets it be cleared.
  const [reporterId, setReporterId] = React.useState<string | undefined>(params.get("reporter_id") ?? undefined);

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  const [sortBy, sortDir] = sort.split(":");

  const query = useQuery({
    queryKey: ["admin", "reports", { debouncedSearch, status, priority, damageType, sort, page, reporterId }],
    queryFn: () =>
      api.get<Paginated<ComplaintSummary>>("/admin/reports", {
        page,
        page_size: PAGE_SIZE,
        sort_by: sortBy,
        sort_dir: sortDir,
        search: debouncedSearch || undefined,
        status: statusParam(status),
        awaiting_verification: status === AWAITING_VERIFICATION ? true : undefined,
        overdue: status === OVERDUE ? true : undefined,
        priority_level: priority === ANY ? undefined : priority,
        damage_type: damageType === ANY ? undefined : damageType,
        reporter_id: reporterId,
      }),
    placeholderData: keepPreviousData,
  });

  const hasFilters =
    debouncedSearch !== "" || status !== ANY || priority !== ANY || damageType !== ANY || Boolean(reporterId);

  function clearFilters() {
    setSearch("");
    setStatus(ANY);
    setPriority(ANY);
    setDamageType(ANY);
    setReporterId(undefined);
    setPage(1);
    router.replace("/admin/reports");
  }

  return (
    <>
      <PageHeading
        title="Reports"
        description="Every report the system holds, including the rejected and duplicate ones that citizens do not see."
      />

      {reporterId ? (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
          <span>Showing only reports from one user.</span>
          <Button variant="ghost" size="sm" onClick={() => setReporterId(undefined)}>
            <X aria-hidden="true" />
            Clear
          </Button>
        </div>
      ) : null}

      <div className="mb-5 space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative lg:col-span-2">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by report number, road or description"
              aria-label="Search reports"
              className="pl-9"
            />
          </div>

          <Select
            value={status}
            onValueChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
          >
            <SelectTrigger aria-label="Filter by status">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>All statuses</SelectItem>
              <SelectItem value={AWAITING_REVIEW}>Awaiting review</SelectItem>
              <SelectItem value={AWAITING_VERIFICATION}>Awaiting verification</SelectItem>
              <SelectItem value={OVERDUE}>Overdue</SelectItem>
              {ALL_STATUSES.map((item) => (
                <SelectItem key={item} value={item}>
                  {STATUS_LABELS[item]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={priority}
            onValueChange={(value) => {
              setPriority(value);
              setPage(1);
            }}
          >
            <SelectTrigger aria-label="Filter by priority">
              <SelectValue placeholder="All priorities" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>All priorities</SelectItem>
              {PRIORITY_ORDER.map((level) => (
                <SelectItem key={level} value={level}>
                  {PRIORITY_LABELS[level]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={damageType}
              onValueChange={(value) => {
                setDamageType(value);
                setPage(1);
              }}
            >
              <SelectTrigger className="h-8 w-[12rem] text-xs" aria-label="Filter by damage type">
                <SelectValue placeholder="All damage types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>All damage types</SelectItem>
                {REPORTABLE_DAMAGE_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {DAMAGE_TYPE_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={sort} onValueChange={setSort}>
              <SelectTrigger className="h-8 w-[11rem] text-xs" aria-label="Sort reports">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {hasFilters ? (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X aria-hidden="true" />
              Clear filters
            </Button>
          ) : null}
        </div>
      </div>

      {query.isPending ? (
        <TableSkeleton rows={8} columns={6} />
      ) : query.isError ? (
        <ErrorState
          title="Could not load the queue"
          description={errorMessage(query.error)}
          onRetry={() => query.refetch()}
        />
      ) : query.data.items.length === 0 ? (
        <EmptyState
          title="No reports match those filters"
          description="Try widening the search or clearing the filters."
          action={
            hasFilters ? (
              <Button variant="outline" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : null
          }
        />
      ) : (
        <>
          <p className="mb-3 text-sm text-muted-foreground" aria-live="polite">
            {query.data.meta.total} report{query.data.meta.total === 1 ? "" : "s"}
          </p>

          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <caption className="sr-only">Reports matching the current filters</caption>
              <thead>
                <tr className="border-b border-border text-left">
                  <th scope="col" className="px-4 py-3 text-xs font-medium text-muted-foreground">
                    Report
                  </th>
                  <th scope="col" className="px-4 py-3 text-xs font-medium text-muted-foreground">
                    Priority
                  </th>
                  <th scope="col" className="px-4 py-3 text-xs font-medium text-muted-foreground">
                    Type
                  </th>
                  <th scope="col" className="px-4 py-3 text-xs font-medium text-muted-foreground">
                    Status
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-right text-xs font-medium text-muted-foreground"
                  >
                    Reports
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-right text-xs font-medium text-muted-foreground"
                  >
                    Submitted
                  </th>
                </tr>
              </thead>

              <tbody>
                {query.data.items.map((report) => (
                  <tr key={report.id} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/reports/${report.id}`}
                        className="block max-w-xs focus:outline-none focus-visible:underline"
                      >
                        <span className="block truncate font-medium">
                          {report.road_name ?? "Unnamed road"}
                        </span>
                        <span className="block font-mono text-[11px] text-muted-foreground">
                          {report.complaint_number}
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <PriorityBadge level={report.priority_level} score={report.priority_score} />
                    </td>
                    <td className="px-4 py-3">
                      <DamageTypeBadge type={report.damage_type} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge status={report.status} />
                        {/* The report status alone reads "In progress" for the
                            whole repair; this is what tells an admin it is
                            their turn to approve, whatever status filter they
                            are looking under. */}
                        {report.assignment_status === "COMPLETED" ? (
                          <RepairStatusBadge status="COMPLETED" />
                        ) : null}
                        {report.is_overdue ? (
                          <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">
                            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                            Overdue
                          </Badge>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{report.report_count}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-muted-foreground">
                      {timeAgo(report.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {query.data.meta.pages > 1 ? (
            <nav
              className="mt-5 flex items-center justify-between border-t border-border pt-5"
              aria-label="Pagination"
            >
              <Button
                variant="outline"
                size="sm"
                disabled={!query.data.meta.has_previous}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {query.data.meta.page} of {query.data.meta.pages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={!query.data.meta.has_next}
                onClick={() => setPage((value) => value + 1)}
              >
                Next
              </Button>
            </nav>
          ) : null}
        </>
      )}

      <p className="mt-6 text-xs text-muted-foreground">{PRIORITY_DISCLAIMER}</p>
    </>
  );
}
