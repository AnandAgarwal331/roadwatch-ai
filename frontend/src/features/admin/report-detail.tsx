"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, RefreshCw } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { DamageTypeBadge, PriorityBadge, StatusBadge } from "@/components/complaints/badges";
import { ContextPanel } from "@/components/complaints/context-panel";
import { DetectionOverlay } from "@/components/complaints/detection-overlay";
import { PriorityBreakdown } from "@/components/complaints/priority-breakdown";
import { StatusTimeline } from "@/components/complaints/status-timeline";
import { PageHeading } from "@/components/dashboard/dashboard-shell";
import { ErrorState, PanelSkeleton } from "@/components/shared/states";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { AdminActions } from "@/features/admin/report-actions";
import { api, errorMessage } from "@/lib/api";
import { AUDIT_ACTION_LABELS, PRIORITY_DISCLAIMER, SEVERITY_DISCLAIMER } from "@/lib/constants";
import { formatDateTime, humanise } from "@/lib/utils";
import type { AuditEntry, ComplaintDetail, DuplicateLink } from "@/types";

export function ReportDetail({ complaintId }: { complaintId: string }) {
  const queryClient = useQueryClient();
  const { success, error: toastError } = useToast();

  const query = useQuery({
    queryKey: ["admin", "report", complaintId],
    queryFn: () => api.get<ComplaintDetail>(`/admin/reports/${complaintId}`),
  });

  const reassess = useMutation({
    mutationFn: () => api.post<ComplaintDetail>(`/admin/reports/${complaintId}/reassess`),
    onSuccess: () => {
      success("Assessment re-run", "The score has been recalculated from current conditions.");
      void queryClient.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (error) => toastError("Could not re-run the assessment", errorMessage(error)),
  });

  if (query.isPending) {
    return (
      <>
        <PageHeading title="Report" />
        <PanelSkeleton />
      </>
    );
  }

  if (query.isError) {
    return (
      <>
        <PageHeading title="Report" />
        <ErrorState
          title="Could not load this report"
          description={errorMessage(query.error)}
          onRetry={() => query.refetch()}
        />
      </>
    );
  }

  const complaint = query.data;
  const primaryImage = complaint.images[0];

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2">
        <Link href="/admin/reports">
          <ArrowLeft aria-hidden="true" />
          Back to reports
        </Link>
      </Button>

      <PageHeading
        title={complaint.road_name ?? "Unnamed road"}
        description={`${complaint.complaint_number} - submitted ${formatDateTime(complaint.created_at)}`}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => reassess.mutate()}
              disabled={reassess.isPending}
            >
              <RefreshCw aria-hidden="true" />
              {reassess.isPending ? "Re-running..." : "Re-run assessment"}
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/reports/${complaint.id}`}>
                Citizen view
                <ExternalLink aria-hidden="true" />
              </Link>
            </Button>
          </>
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <PriorityBadge level={complaint.priority_level} score={complaint.priority_score} />
        <StatusBadge status={complaint.status} />
        <DamageTypeBadge type={complaint.damage_type} />
        {complaint.report_count > 1 ? (
          <Badge variant="muted">{complaint.report_count} reports merged</Badge>
        ) : null}
        {complaint.manual_priority_override !== null ? (
          <Badge variant="warning">Priority overridden</Badge>
        ) : null}
      </div>

      {complaint.rejection_reason ? (
        <Alert variant="destructive" title="This report was rejected" className="mb-6">
          {complaint.rejection_reason}
        </Alert>
      ) : null}

      {complaint.duplicate_of_id ? (
        <Alert variant="info" title="Merged as a duplicate" className="mb-6">
          This report was merged into{" "}
          <Link
            href={`/admin/reports/${complaint.duplicate_of_id}`}
            className="font-medium underline"
          >
            the canonical report
          </Link>
          .
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <Tabs defaultValue="report">
            <TabsList>
              <TabsTrigger value="report">Report</TabsTrigger>
              <TabsTrigger value="score">Score</TabsTrigger>
              <TabsTrigger value="context">Context</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
            </TabsList>

            <TabsContent value="report" className="space-y-6">
              {primaryImage ? (
                <DetectionOverlay
                  imageUrl={primaryImage.url}
                  alt={`Photo submitted with report ${complaint.complaint_number}`}
                  detections={complaint.latest_analysis?.detections ?? []}
                  width={primaryImage.width}
                  height={primaryImage.height}
                />
              ) : null}

              <Card>
                <CardHeader>
                  <CardTitle>What the citizen reported</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm leading-relaxed">
                    {complaint.description ?? "No description was provided."}
                  </p>

                  <dl className="grid gap-4 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-xs text-muted-foreground">Reported as</dt>
                      <dd className="mt-0.5 font-medium">
                        {complaint.reported_damage_type
                          ? humanise(complaint.reported_damage_type)
                          : "Not specified"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Classified by AI as</dt>
                      <dd className="mt-0.5 font-medium">{humanise(complaint.damage_type)}</dd>
                    </div>
                    {complaint.reporter ? (
                      <>
                        <div>
                          <dt className="text-xs text-muted-foreground">Reporter</dt>
                          <dd className="mt-0.5 font-medium">{complaint.reporter.full_name}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">Contact</dt>
                          <dd className="mt-0.5 truncate font-medium">
                            {complaint.reporter.email}
                          </dd>
                        </div>
                      </>
                    ) : null}
                  </dl>

                  <p className="text-xs text-muted-foreground">{SEVERITY_DISCLAIMER}</p>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="score">
              <Card>
                <CardContent className="pt-6">
                  {complaint.priority ? (
                    <PriorityBreakdown assessment={complaint.priority} />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      This report has not been scored yet.
                    </p>
                  )}
                  <p className="mt-6 text-xs text-muted-foreground">{PRIORITY_DISCLAIMER}</p>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="context">
              <Card>
                <CardContent className="pt-6">
                  <ContextPanel complaint={complaint} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="history" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Status history</CardTitle>
                </CardHeader>
                <CardContent>
                  <StatusTimeline
                    history={complaint.status_history}
                    currentStatus={complaint.status}
                  />
                </CardContent>
              </Card>

              <AuditForComplaint complaintId={complaint.id} />
            </TabsContent>
          </Tabs>
        </div>

        <aside className="space-y-6">
          <AdminActions complaint={complaint} />
          <DuplicateLinks complaintId={complaint.id} />
        </aside>
      </div>
    </>
  );
}

/** The audit entries for this one report, so the trail sits next to the work. */
function AuditForComplaint({ complaintId }: { complaintId: string }) {
  const query = useQuery({
    queryKey: ["admin", "audit", complaintId],
    queryFn: () => api.get<AuditEntry[]>("/admin/audit", { complaint_id: complaintId, limit: 50 }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit trail</CardTitle>
      </CardHeader>
      <CardContent>
        {query.isPending ? (
          <PanelSkeleton />
        ) : query.isError ? (
          <p className="text-sm text-muted-foreground">Could not load the audit trail.</p>
        ) : query.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No changes have been recorded yet.</p>
        ) : (
          <ol className="space-y-3">
            {query.data.map((entry) => (
              <li key={entry.id} className="border-l-2 border-border pl-3">
                <p className="text-sm font-medium">
                  {AUDIT_ACTION_LABELS[entry.action] ?? humanise(entry.action)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {entry.actor_email ?? "System"} &middot; {formatDateTime(entry.created_at)}
                </p>
                {entry.note ? <p className="mt-1 text-xs">{entry.note}</p> : null}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

/** How a link that has already been decided should read. */
const DUPLICATE_STATUS: Record<DuplicateLink["status"], { label: string; variant: "muted" | "success" | "outline" }> =
  {
    SUGGESTED: { label: "Awaiting review", variant: "muted" },
    CONFIRMED: { label: "Merged", variant: "success" },
    REJECTED: { label: "Separate", variant: "outline" },
  };

/**
 * Duplicate links attached to this report.
 *
 * The endpoint returns links in every state, not just pending ones, so each row
 * carries its decision. Calling a link an administrator already dismissed a
 * "possible duplicate" would ask them to review the same pair forever.
 */
function DuplicateLinks({ complaintId }: { complaintId: string }) {
  const query = useQuery({
    queryKey: ["admin", "report-duplicates", complaintId],
    queryFn: () => api.get<DuplicateLink[]>(`/admin/reports/${complaintId}/duplicates`),
  });

  if (query.isPending || query.isError || query.data.length === 0) return null;

  const pending = query.data.filter((link) => link.status === "SUGGESTED");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Related reports</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {pending.length > 0
            ? `${pending.length} pair${pending.length === 1 ? "" : "s"} nearby still need a decision.`
            : "Every nearby match on this report has already been decided."}
        </p>

        <ul className="space-y-2 text-sm">
          {query.data.map((link) => {
            // The link points both ways; show whichever end is not this report.
            const other =
              link.complaint_id === complaintId
                ? { id: link.duplicate_complaint_id, number: link.duplicate_complaint_number }
                : { id: link.complaint_id, number: link.complaint_number };
            const state = DUPLICATE_STATUS[link.status];

            return (
              <li key={link.id} className="flex items-center justify-between gap-2">
                <Link
                  href={`/admin/reports/${other.id}`}
                  className="font-mono text-xs hover:underline"
                >
                  {other.number}
                </Link>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {Math.round(link.similarity_score * 100)}%
                  </span>
                  <Badge variant={state.variant}>{state.label}</Badge>
                </span>
              </li>
            );
          })}
        </ul>

        {pending.length > 0 ? (
          <Button asChild variant="outline" size="sm" className="w-full">
            <Link href="/admin/duplicates">Review duplicates</Link>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
