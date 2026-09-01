"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ClipboardList, Plus } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { ComplaintCard } from "@/components/complaints/complaint-card";
import { StatCard, StatGrid } from "@/components/dashboard/stat-card";
import { CardGridSkeleton, EmptyState, ErrorState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, errorMessage } from "@/lib/api";
import { STATUS_LABELS } from "@/lib/constants";
import type { ComplaintStatus, ComplaintSummary, Paginated } from "@/types";

const ANY = "ANY";
const PAGE_SIZE = 12;

const FILTERABLE: ComplaintStatus[] = [
  "PENDING",
  "AI_ANALYZED",
  "PRIORITIZED",
  "ASSIGNED",
  "IN_PROGRESS",
  "RESOLVED",
  "REJECTED",
  "DUPLICATE",
];

const SORT_OPTIONS = [
  { value: "created_at:desc", label: "Newest first" },
  { value: "created_at:asc", label: "Oldest first" },
  { value: "priority_score:desc", label: "Highest priority" },
];

/** Statuses that mean the report is still working its way through. */
const OPEN_STATUSES: ComplaintStatus[] = [
  "PENDING",
  "AI_ANALYZED",
  "PRIORITIZED",
  "ASSIGNED",
  "IN_PROGRESS",
];

export function MyReports() {
  const [status, setStatus] = React.useState<string>(ANY);
  const [sort, setSort] = React.useState<string>("created_at:desc");
  const [page, setPage] = React.useState(1);

  const [sortBy, sortDir] = sort.split(":");

  const query = useQuery({
    queryKey: ["my-complaints", { status, sort, page }],
    queryFn: () =>
      api.get<Paginated<ComplaintSummary>>("/complaints/mine", {
        page,
        page_size: PAGE_SIZE,
        sort_by: sortBy,
        sort_dir: sortDir,
        status: status === ANY ? undefined : status,
      }),
    placeholderData: keepPreviousData,
  });

  // Counted from the page in hand, so the wording stays honest about scope.
  const items = query.data?.items ?? [];
  const openCount = items.filter((item) => OPEN_STATUSES.includes(item.status)).length;
  const resolvedCount = items.filter((item) => item.status === "RESOLVED").length;

  return (
    <div className="space-y-6">
      {query.data && status === ANY ? (
        <StatGrid className="lg:grid-cols-3">
          <StatCard label="Reports submitted" value={query.data.meta.total} icon={ClipboardList} />
          <StatCard
            label="Still open"
            value={openCount}
            hint="On this page"
            tone={openCount > 0 ? "warning" : "default"}
          />
          <StatCard
            label="Resolved"
            value={resolvedCount}
            hint="On this page"
            tone={resolvedCount > 0 ? "success" : "default"}
          />
        </StatGrid>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
          >
            <SelectTrigger className="h-9 w-[12rem]" aria-label="Filter by status">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>All statuses</SelectItem>
              {FILTERABLE.map((item) => (
                <SelectItem key={item} value={item}>
                  {STATUS_LABELS[item]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="h-9 w-[11rem]" aria-label="Sort reports">
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

        <Button asChild size="sm">
          <Link href="/report">
            <Plus aria-hidden="true" />
            Report a problem
          </Link>
        </Button>
      </div>

      {query.isPending ? (
        <CardGridSkeleton count={6} />
      ) : query.isError ? (
        <ErrorState
          title="Could not load your reports"
          description={errorMessage(query.error)}
          onRetry={() => query.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={status === ANY ? "You have not reported anything yet" : "Nothing with that status"}
          description={
            status === ANY
              ? "When you report a road problem it will appear here, and you can follow it all the way to repair."
              : "Try a different status filter."
          }
          action={
            status === ANY ? (
              <Button asChild size="sm">
                <Link href="/report">Report a problem</Link>
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setStatus(ANY)}>
                Show all
              </Button>
            )
          }
        />
      ) : (
        <>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((complaint) => (
              <ComplaintCard key={complaint.id} complaint={complaint} />
            ))}
          </div>

          {query.data.meta.pages > 1 ? (
            <nav
              className="flex items-center justify-between border-t border-border pt-5"
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
    </div>
  );
}
