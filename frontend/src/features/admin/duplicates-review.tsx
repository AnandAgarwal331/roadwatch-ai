"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Merge, SplitSquareHorizontal } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { PageHeading } from "@/components/dashboard/dashboard-shell";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api";
import { formatDistance, timeAgo } from "@/lib/utils";
import type { DuplicateLink, MessageResponse } from "@/types";

export function DuplicatesReview() {
  const queryClient = useQueryClient();
  const { success, error: toastError } = useToast();

  const query = useQuery({
    queryKey: ["admin", "duplicates"],
    queryFn: () => api.get<DuplicateLink[]>("/admin/duplicates", { limit: 100 }),
  });

  // Tracks which row is mid-decision so only that card's buttons go busy.
  const [pending, setPending] = React.useState<string | null>(null);

  const decide = useMutation({
    mutationFn: ({ linkId, confirm }: { linkId: string; confirm: boolean }) =>
      api.post<MessageResponse>(`/admin/duplicates/${linkId}/${confirm ? "confirm" : "reject"}`),
    onMutate: ({ linkId }) => setPending(linkId),
    onSettled: () => setPending(null),
    onSuccess: (response) => {
      success(response.message, response.detail ?? undefined);
      void queryClient.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (error) => toastError("Could not record that decision", errorMessage(error)),
  });

  return (
    <>
      <PageHeading
        title="Duplicates"
        description="Pairs of reports the system believes describe the same problem, judged on how close together they are, how alike the damage is, and how near in time they arrived."
      />

      {query.isPending ? (
        <TableSkeleton rows={5} columns={3} />
      ) : query.isError ? (
        <ErrorState
          title="Could not load duplicate suggestions"
          description={errorMessage(query.error)}
          onRetry={() => query.refetch()}
        />
      ) : query.data.length === 0 ? (
        <EmptyState
          icon={Copy}
          title="Nothing waiting to be reviewed"
          description="When two reports look like the same problem, the pair will appear here for a decision."
        />
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {query.data.length} pair{query.data.length === 1 ? "" : "s"} awaiting a decision
          </p>

          {query.data.map((link) => (
            <Card key={link.id}>
              <CardContent className="pt-6">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="muted">
                    {Math.round(link.similarity_score * 100)}% similar
                  </Badge>
                  <Badge variant="outline">{formatDistance(link.distance_meters)} apart</Badge>
                  <span className="text-xs text-muted-foreground">
                    Flagged {timeAgo(link.created_at)}
                  </span>
                </div>

                <p className="mt-3 text-sm">{link.reason}</p>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <ReportRef
                    label="Keep as the main report"
                    id={link.complaint_id}
                    number={link.complaint_number}
                  />
                  <ReportRef
                    label="Would be merged into it"
                    id={link.duplicate_complaint_id}
                    number={link.duplicate_complaint_number}
                  />
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={pending === link.id}
                    onClick={() => decide.mutate({ linkId: link.id, confirm: true })}
                  >
                    <Merge aria-hidden="true" />
                    Same problem - merge
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending === link.id}
                    onClick={() => decide.mutate({ linkId: link.id, confirm: false })}
                  >
                    <SplitSquareHorizontal aria-hidden="true" />
                    Different problems
                  </Button>
                </div>

                <p className="mt-3 text-xs text-muted-foreground">
                  Merging keeps the main report and folds the other into its report count, so the
                  duplicate stops competing for attention in the queue.
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function ReportRef({ label, id, number }: { label: string; id: string; number: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <Link
        href={`/admin/reports/${id}`}
        className="mt-1 block font-mono text-sm font-medium hover:underline"
      >
        {number || "Unknown report"}
      </Link>
    </div>
  );
}
