"use client";

import { useQuery } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { IssueMapView } from "@/components/map/map-view";
import { ErrorState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api";
import { PRIORITY_HEX, PRIORITY_LABELS, PRIORITY_ORDER } from "@/lib/constants";
import type { MapIssue, PriorityLevel } from "@/types";

const EMPTY_ISSUES: MapIssue[] = [];

/**
 * A live, at-a-glance look at what is currently open across the city -
 * unfiltered by design. It is a preview, not a replacement for the full map:
 * one click takes you there for the filters and heatmap mode.
 */
export function DashboardMapWidget() {
  const query = useQuery({
    queryKey: ["admin", "dashboard-map"],
    queryFn: () => api.get<MapIssue[]>("/map/issues", { limit: 500, exclude_closed: "true" }),
  });

  const issues = query.data ?? EMPTY_ISSUES;

  const counts = React.useMemo(() => {
    const result: Record<PriorityLevel, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    for (const issue of issues) result[issue.priority_level] += 1;
    return result;
  }, [issues]);

  return (
    <Card className="glow-hover mb-8 animate-fade-up overflow-hidden p-0 [animation-delay:30ms]">
      <div className="flex items-center justify-between gap-3 border-b border-border p-4 sm:p-5">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-display text-sm font-semibold">
            <MapPin className="h-4 w-4 text-primary" aria-hidden="true" />
            Live report map
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Every open report across the city, right now.
          </p>
        </div>
        <Button asChild variant="outline" size="sm" className="shrink-0">
          <Link href="/admin/map">Open full map</Link>
        </Button>
      </div>

      {query.isError ? (
        <div className="p-5">
          <ErrorState
            title="Could not load the map"
            description={errorMessage(query.error)}
            onRetry={() => query.refetch()}
          />
        </div>
      ) : query.isPending ? (
        <Skeleton className="h-[320px] w-full rounded-none" />
      ) : (
        <>
          <div className="h-[320px] w-full">
            <IssueMapView
              issues={issues}
              detailBasePath="/admin/reports"
              fitToIssues={issues.length > 0}
            />
          </div>

          <ul className="flex flex-wrap items-center gap-4 border-t border-border p-4 text-sm sm:p-5">
            {PRIORITY_ORDER.map((level) => (
              <li key={level} className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-full"
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
        </>
      )}
    </Card>
  );
}
