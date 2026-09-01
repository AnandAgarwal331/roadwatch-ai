"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Filter, Search, X } from "lucide-react";
import * as React from "react";

import { ComplaintCard } from "@/components/complaints/complaint-card";
import { CardGridSkeleton, EmptyState, ErrorState } from "@/components/shared/states";
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
  PRIORITY_LABELS,
  PRIORITY_ORDER,
  REPORTABLE_DAMAGE_TYPES,
  STATUS_LABELS,
} from "@/lib/constants";
import type { ComplaintStatus, ComplaintSummary, DamageType, Paginated, PriorityLevel } from "@/types";

const ANY = "ANY";
const PAGE_SIZE = 12;

const BROWSABLE_STATUSES: ComplaintStatus[] = [
  "PENDING",
  "AI_ANALYZED",
  "PRIORITIZED",
  "ASSIGNED",
  "IN_PROGRESS",
  "RESOLVED",
];

const SORT_OPTIONS = [
  { value: "created_at:desc", label: "Newest first" },
  { value: "priority_score:desc", label: "Highest priority" },
  { value: "priority_score:asc", label: "Lowest priority" },
  { value: "report_count:desc", label: "Most reported" },
] as const;

export function ReportsBrowser() {
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [damageType, setDamageType] = React.useState<string>(ANY);
  const [status, setStatus] = React.useState<string>(ANY);
  const [priority, setPriority] = React.useState<string>(ANY);
  const [sort, setSort] = React.useState<string>("created_at:desc");
  const [page, setPage] = React.useState(1);

  // Debounce so typing does not fire a request per keystroke.
  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  const [sortBy, sortDir] = sort.split(":");

  const query = useQuery({
    queryKey: ["complaints", { debouncedSearch, damageType, status, priority, sort, page }],
    queryFn: () =>
      api.get<Paginated<ComplaintSummary>>("/complaints", {
        page,
        page_size: PAGE_SIZE,
        sort_by: sortBy,
        sort_dir: sortDir,
        search: debouncedSearch || undefined,
        damage_type: damageType === ANY ? undefined : damageType,
        status: status === ANY ? undefined : status,
        priority_level: priority === ANY ? undefined : priority,
      }),
    placeholderData: keepPreviousData,
  });

  const hasFilters =
    debouncedSearch !== "" || damageType !== ANY || status !== ANY || priority !== ANY;

  function clearFilters() {
    setSearch("");
    setDamageType(ANY);
    setStatus(ANY);
    setPriority(ANY);
    setPage(1);
  }

  return (
    <div className="space-y-6">
      {/* -- Filters ------------------------------------------------------ */}
      <div className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Filter className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Filter reports
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="relative lg:col-span-2">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by ID, road or description"
              aria-label="Search reports"
              className="pl-9"
            />
          </div>

          <FilterSelect
            label="Damage type"
            value={damageType}
            onChange={(value) => {
              setDamageType(value);
              setPage(1);
            }}
            options={REPORTABLE_DAMAGE_TYPES.map((type) => ({
              value: type,
              label: DAMAGE_TYPE_LABELS[type as DamageType],
            }))}
            anyLabel="All damage types"
          />

          <FilterSelect
            label="Status"
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            options={BROWSABLE_STATUSES.map((item) => ({
              value: item,
              label: STATUS_LABELS[item],
            }))}
            anyLabel="All statuses"
          />

          <FilterSelect
            label="Priority"
            value={priority}
            onChange={(value) => {
              setPriority(value);
              setPage(1);
            }}
            options={PRIORITY_ORDER.map((level) => ({
              value: level,
              label: PRIORITY_LABELS[level as PriorityLevel],
            }))}
            anyLabel="All priorities"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex items-center gap-2">
            <label htmlFor="sort" className="text-xs text-muted-foreground">
              Sort by
            </label>
            <Select value={sort} onValueChange={setSort}>
              <SelectTrigger id="sort" className="h-8 w-[11rem] text-xs">
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

      {/* -- Results ------------------------------------------------------ */}
      {query.isPending ? (
        <CardGridSkeleton count={6} />
      ) : query.isError ? (
        <ErrorState
          title="Could not load reports"
          description={errorMessage(query.error)}
          onRetry={() => query.refetch()}
        />
      ) : query.data.items.length === 0 ? (
        <EmptyState
          title="No reports match those filters"
          description={
            hasFilters
              ? "Try widening your search or clearing the filters."
              : "No road problems have been reported yet."
          }
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
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {query.data.meta.total} report{query.data.meta.total === 1 ? "" : "s"} found
          </p>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {query.data.items.map((complaint) => (
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

function FilterSelect({
  label,
  value,
  onChange,
  options,
  anyLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  anyLabel: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label}>
        <SelectValue placeholder={anyLabel} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY}>{anyLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
