"use client";

import { useQuery } from "@tanstack/react-query";
import { Filter, X } from "lucide-react";
import * as React from "react";

import { IssueMapView } from "@/components/map/map-view";
import { ErrorState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
  PRIORITY_HEX,
  PRIORITY_LABELS,
  PRIORITY_ORDER,
  REPORTABLE_DAMAGE_TYPES,
  STATUS_LABELS,
} from "@/lib/constants";
import type { ComplaintStatus, DamageType, MapIssue, PriorityLevel } from "@/types";

/** Stable empty result, so an empty response does not churn the memo. */
const EMPTY_ISSUES: MapIssue[] = [];

const ANY = "ANY";

const MAP_STATUSES: ComplaintStatus[] = [
  "PENDING",
  "AI_ANALYZED",
  "PRIORITIZED",
  "ASSIGNED",
  "IN_PROGRESS",
  "RESOLVED",
];

const DATE_RANGES = [
  { value: ANY, label: "Any time" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

interface CityMapProps {
  /** Admin view keeps closed reports available and links into the admin detail. */
  admin?: boolean;
}

export function CityMap({ admin = false }: CityMapProps) {
  const [damageType, setDamageType] = React.useState(ANY);
  const [priority, setPriority] = React.useState(ANY);
  const [status, setStatus] = React.useState(ANY);
  const [days, setDays] = React.useState(ANY);
  const [openOnly, setOpenOnly] = React.useState(false);

  const createdFrom = React.useMemo(() => {
    if (days === ANY) return undefined;
    const date = new Date();
    date.setDate(date.getDate() - Number(days));
    return date.toISOString();
  }, [days]);

  const query = useQuery({
    queryKey: ["map-issues", { damageType, priority, status, createdFrom, openOnly }],
    queryFn: () =>
      api.get<MapIssue[]>("/map/issues", {
        limit: 2000,
        damage_type: damageType === ANY ? undefined : damageType,
        priority_level: priority === ANY ? undefined : priority,
        status: status === ANY ? undefined : status,
        created_from: createdFrom,
        exclude_closed: openOnly ? "true" : undefined,
      }),
  });

  // `?? []` would allocate a new array every render and defeat the memo below.
  const issues = React.useMemo(() => query.data ?? EMPTY_ISSUES, [query.data]);
  const hasFilters = damageType !== ANY || priority !== ANY || status !== ANY || days !== ANY || openOnly;

  const counts = React.useMemo(() => {
    const result: Record<PriorityLevel, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    for (const issue of issues) result[issue.priority_level] += 1;
    return result;
  }, [issues]);

  function clearFilters() {
    setDamageType(ANY);
    setPriority(ANY);
    setStatus(ANY);
    setDays(ANY);
    setOpenOnly(false);
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Filter className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Filter map
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select value={damageType} onValueChange={setDamageType}>
            <SelectTrigger aria-label="Damage type">
              <SelectValue placeholder="All damage types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>All damage types</SelectItem>
              {REPORTABLE_DAMAGE_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {DAMAGE_TYPE_LABELS[type as DamageType]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger aria-label="Priority">
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

          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger aria-label="Status">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>All statuses</SelectItem>
              {MAP_STATUSES.map((item) => (
                <SelectItem key={item} value={item}>
                  {STATUS_LABELS[item]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={days} onValueChange={setDays}>
            <SelectTrigger aria-label="Date range">
              <SelectValue placeholder="Any time" />
            </SelectTrigger>
            <SelectContent>
              {DATE_RANGES.map((range) => (
                <SelectItem key={range.value} value={range.value}>
                  {range.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={openOnly}
              onChange={(event) => setOpenOnly(event.target.checked)}
              className="h-4 w-4 rounded border-input accent-[hsl(var(--primary))]"
            />
            Open issues only
          </label>

          {hasFilters ? (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X aria-hidden="true" />
              Clear filters
            </Button>
          ) : null}
        </div>
      </Card>

      {query.isError ? (
        <ErrorState
          title="Could not load the map"
          description={errorMessage(query.error)}
          onRetry={() => query.refetch()}
        />
      ) : (
        <>
          <Card className="overflow-hidden p-0">
            <div className="h-[560px] w-full">
              <IssueMapView
                issues={issues}
                detailBasePath={admin ? "/admin/reports" : "/reports"}
                fitToIssues={issues.length > 0}
              />
            </div>
          </Card>

          <div className="flex flex-wrap items-center justify-between gap-4">
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
                    <span className="ml-1.5 font-medium tabular-nums text-foreground">
                      {counts[level]}
                    </span>
                  </span>
                </li>
              ))}
            </ul>

            <p className="text-sm text-muted-foreground" aria-live="polite">
              {query.isFetching
                ? "Updating..."
                : `${issues.length} issue${issues.length === 1 ? "" : "s"} shown`}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
