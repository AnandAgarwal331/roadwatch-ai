"use client";

import { useQuery } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { PageHeading } from "@/components/dashboard/dashboard-shell";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";
import { AUDIT_ACTION_LABELS } from "@/lib/constants";
import { formatDateTime, humanise } from "@/lib/utils";
import type { AuditEntry } from "@/types";

const LIMITS = [50, 100, 250];

export function AuditTrail() {
  const [limit, setLimit] = React.useState(100);

  const query = useQuery({
    queryKey: ["admin", "audit", "all", limit],
    queryFn: () => api.get<AuditEntry[]>("/admin/audit", { limit }),
  });

  return (
    <>
      <PageHeading
        title="Audit trail"
        description="Every change to a report or a crew, with the account that made it. This is the record that shows a priority score was reviewed by a person, not applied blindly."
        actions={
          <div className="flex gap-1" role="group" aria-label="Number of entries">
            {LIMITS.map((value) => (
              <Button
                key={value}
                size="sm"
                variant={limit === value ? "default" : "outline"}
                aria-pressed={limit === value}
                onClick={() => setLimit(value)}
              >
                {value}
              </Button>
            ))}
          </div>
        }
      />

      {query.isPending ? (
        <TableSkeleton rows={10} columns={4} />
      ) : query.isError ? (
        <ErrorState
          title="Could not load the audit trail"
          description={errorMessage(query.error)}
          onRetry={() => query.refetch()}
        />
      ) : query.data.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title="Nothing recorded yet"
          description="Changes to reports and crews will be listed here as they happen."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <caption className="sr-only">Recent changes across the system</caption>
            <thead>
              <tr className="border-b border-border text-left">
                <th scope="col" className="px-4 py-3 text-xs font-medium text-muted-foreground">
                  What changed
                </th>
                <th scope="col" className="px-4 py-3 text-xs font-medium text-muted-foreground">
                  Who
                </th>
                <th scope="col" className="px-4 py-3 text-xs font-medium text-muted-foreground">
                  Report
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-right text-xs font-medium text-muted-foreground"
                >
                  When
                </th>
              </tr>
            </thead>

            <tbody>
              {query.data.map((entry) => (
                <tr key={entry.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-3">
                    <span className="font-medium">
                      {AUDIT_ACTION_LABELS[entry.action] ?? humanise(entry.action)}
                    </span>
                    {entry.note ? (
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {entry.note}
                      </span>
                    ) : null}
                    <ValueChange entry={entry} />
                  </td>

                  <td className="px-4 py-3">
                    {entry.actor_email ? (
                      <span className="truncate">{entry.actor_email}</span>
                    ) : (
                      <Badge variant="muted">System</Badge>
                    )}
                  </td>

                  <td className="px-4 py-3">
                    {entry.complaint_id ? (
                      <Link
                        href={`/admin/reports/${entry.complaint_id}`}
                        className="font-mono text-xs hover:underline"
                      >
                        View report
                      </Link>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {humanise(entry.entity_type)}
                      </span>
                    )}
                  </td>

                  <td className="whitespace-nowrap px-4 py-3 text-right text-muted-foreground">
                    {formatDateTime(entry.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/**
 * The before and after of a change, when the entry recorded one.
 *
 * Values are arbitrary JSON, so they are rendered as compact key/value pairs
 * rather than assuming any particular shape.
 */
function ValueChange({ entry }: { entry: AuditEntry }) {
  const changed = entry.new_value;
  if (!changed || Object.keys(changed).length === 0) return null;

  return (
    <span className="mt-1 block text-xs text-muted-foreground">
      {Object.entries(changed).map(([key, value], index) => {
        const before = entry.old_value?.[key];
        return (
          <span key={key} className="mr-3 inline-block">
            {index > 0 ? null : null}
            <span className="font-medium">{humanise(key)}:</span>{" "}
            {before !== undefined && before !== null ? (
              <>
                <span className="line-through">{String(before)}</span>{" "}
                <span aria-label="changed to">&rarr;</span>{" "}
              </>
            ) : null}
            <span>{String(value)}</span>
          </span>
        );
      })}
    </span>
  );
}
