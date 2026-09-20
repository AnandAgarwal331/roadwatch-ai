import { AlertTriangle, ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DamageTypeBadge, PriorityBadge, StatusBadge } from "@/components/complaints/badges";
import { BeforeAfterSlider } from "@/components/complaints/before-after-slider";
import { ContextPanel } from "@/components/complaints/context-panel";
import { DetectionOverlay } from "@/components/complaints/detection-overlay";
import { EvidenceImage } from "@/components/complaints/evidence-image";
import { PriorityBreakdown } from "@/components/complaints/priority-breakdown";
import { StatusTimeline } from "@/components/complaints/status-timeline";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ReanalyzeButton } from "@/features/reports/reanalyze-button";
import { DAMAGE_TYPE_LABELS, SEVERITY_DISCLAIMER } from "@/lib/constants";
import { getCurrentUser, serverFetch } from "@/lib/session";
import { formatDateTime } from "@/lib/utils";
import type { ComplaintDetail } from "@/types";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const complaint = await serverFetch<ComplaintDetail>(`/api/complaints/${id}`);

  if (!complaint) return { title: "Report not found" };

  return {
    title: `${complaint.complaint_number} - ${DAMAGE_TYPE_LABELS[complaint.damage_type]}`,
    description:
      complaint.description ??
      `A ${DAMAGE_TYPE_LABELS[complaint.damage_type].toLowerCase()} reported at ${
        complaint.road_name ?? "an unnamed road"
      }.`,
  };
}

export default async function ReportDetailPage({ params }: PageProps) {
  const { id } = await params;
  const [complaint, user] = await Promise.all([
    serverFetch<ComplaintDetail>(`/api/complaints/${id}`),
    getCurrentUser(),
  ]);

  if (!complaint) notFound();

  const analysis = complaint.latest_analysis;
  const photo = complaint.images.find((image) => image.kind === "REPORT") ?? complaint.images[0];
  const evidence = complaint.images.filter((image) => image.kind === "REPAIR_EVIDENCE");

  // Mirrors the backend's own rule for POST /complaints/:id/analyze: only the
  // reporter, and only before the report is closed (resolved/rejected/
  // marked a duplicate) - an admin can still do this from their own console.
  const isOwner = user !== null && complaint.reporter !== null && user.id === complaint.reporter.id;
  const isClosed = complaint.status === "RESOLVED" || complaint.status === "REJECTED" || complaint.status === "DUPLICATE";
  const canReanalyze = isOwner && !isClosed;

  return (
    <div className="container py-8 md:py-12">
      <Button asChild variant="ghost" size="sm" className="mb-6 -ml-2">
        <Link href="/reports">
          <ArrowLeft aria-hidden="true" />
          All reports
        </Link>
      </Button>

      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm text-muted-foreground">
              {complaint.complaint_number}
            </span>
            <StatusBadge status={complaint.status} />
            <PriorityBadge level={complaint.priority_level} score={complaint.priority_score} />
          </div>

          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            {DAMAGE_TYPE_LABELS[complaint.damage_type]}
            {complaint.road_name ? (
              <span className="font-normal text-muted-foreground"> on {complaint.road_name}</span>
            ) : null}
          </h1>

          <p className="mt-2 text-sm text-muted-foreground">
            Reported {formatDateTime(complaint.created_at)}
            {complaint.resolved_at ? ` · Resolved ${formatDateTime(complaint.resolved_at)}` : ""}
          </p>
        </div>

        {canReanalyze ? <ReanalyzeButton complaintId={complaint.id} /> : null}
      </header>

      {complaint.status === "REJECTED" && complaint.rejection_reason ? (
        <Alert variant="warning" className="mb-6" title="This report was closed without repair">
          <p>{complaint.rejection_reason}</p>
        </Alert>
      ) : null}

      {complaint.status === "DUPLICATE" ? (
        <Alert variant="info" className="mb-6" title="Linked to an existing issue">
          <p>
            This report describes the same problem as another report, and has been merged so the
            works department sees a single job.
          </p>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Reported problem</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {photo ? (
                <DetectionOverlay
                  imageUrl={photo.url}
                  alt={`${DAMAGE_TYPE_LABELS[complaint.damage_type]} reported at ${
                    complaint.road_name ?? "an unnamed road"
                  }`}
                  detections={analysis?.detections ?? []}
                  width={photo.width}
                  height={photo.height}
                />
              ) : (
                <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
                  No photo was submitted with this report.
                </p>
              )}

              {complaint.description ? (
                <div>
                  <h3 className="text-sm font-medium">Description</h3>
                  <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                    {complaint.description}
                  </p>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <DamageTypeBadge type={complaint.damage_type} />
                {complaint.reported_damage_type &&
                complaint.reported_damage_type !== complaint.damage_type ? (
                  <span className="inline-flex items-center rounded-full border border-border bg-muted/60 px-2.5 py-0.5 text-xs text-muted-foreground">
                    Citizen reported: {DAMAGE_TYPE_LABELS[complaint.reported_damage_type]}
                  </span>
                ) : null}
              </div>
            </CardContent>
          </Card>

          {analysis ? (
            <Card>
              <CardHeader>
                <CardTitle>AI analysis</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Metric label="Damage type" value={DAMAGE_TYPE_LABELS[analysis.damage_type]} />
                  <Metric label="Confidence" value={`${Math.round(analysis.confidence * 100)}%`} />
                  <Metric
                    label="Visual severity"
                    value={`${analysis.severity_score.toFixed(1)}/10`}
                  />
                  <Metric
                    label="Damaged area"
                    value={`${Math.round(analysis.damaged_area_ratio * 100)}%`}
                  />
                </dl>

                {!analysis.is_confident ? (
                  <Alert variant="warning" title="Flagged for manual review">
                    <p>
                      The detector was not confident enough in this classification, so the report
                      has been queued for a person to confirm.
                    </p>
                  </Alert>
                ) : null}

                {analysis.severity_explanation ? (
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {analysis.severity_explanation}
                  </p>
                ) : null}

                <p className="flex items-start gap-2 border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
                  <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    {SEVERITY_DISCLAIMER} Model: {analysis.model_name} ({analysis.model_version}).
                  </span>
                </p>
              </CardContent>
            </Card>
          ) : null}

          {evidence.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Repair evidence</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {photo ? (
                  <div>
                    <BeforeAfterSlider
                      beforeSrc={photo.url}
                      beforeAlt={`${DAMAGE_TYPE_LABELS[complaint.damage_type]} as originally reported`}
                      afterSrc={evidence[0].url}
                      afterAlt="Photo submitted by the repair crew showing the completed work"
                    />
                    <p className="mt-2 text-center text-xs text-muted-foreground">
                      Drag to compare the original report with the completed repair
                    </p>
                  </div>
                ) : null}

                {evidence.length > (photo ? 1 : 0) ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {evidence.slice(photo ? 1 : 0).map((image) => (
                      <EvidenceImage
                        key={image.id}
                        src={image.url}
                        alt="Photo submitted by the repair crew showing the completed work"
                        className="rounded-lg border border-border object-cover"
                      />
                    ))}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="space-y-6">
          {complaint.priority ? (
            <Card>
              <CardHeader>
                <CardTitle>Why this priority?</CardTitle>
              </CardHeader>
              <CardContent>
                <PriorityBreakdown assessment={complaint.priority} />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Context</CardTitle>
            </CardHeader>
            <CardContent>
              <ContextPanel complaint={complaint} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Progress</CardTitle>
            </CardHeader>
            <CardContent>
              <StatusTimeline
                history={complaint.status_history}
                currentStatus={complaint.status}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
