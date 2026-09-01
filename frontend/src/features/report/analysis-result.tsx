"use client";

import { AlertTriangle, ArrowRight, CheckCircle2, Copy, Layers, ScanLine } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { DamageTypeBadge, StatusBadge } from "@/components/complaints/badges";
import { DetectionOverlay } from "@/components/complaints/detection-overlay";
import { PriorityBreakdown } from "@/components/complaints/priority-breakdown";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/components/ui/toast";
import { DAMAGE_TYPE_LABELS, SEVERITY_DISCLAIMER } from "@/lib/constants";
import { formatCoordinate } from "@/lib/utils";
import type { ComplaintCreateResponse } from "@/types";

/** Stages narrated while the single submit request is in flight. */
const STAGES = [
  "Uploading your photo...",
  "Analysing road condition...",
  "Estimating visual severity...",
  "Checking nearby facilities and traffic...",
  "Calculating priority...",
];

export function AnalysisProgress() {
  const [stage, setStage] = React.useState(0);

  React.useEffect(() => {
    // Advance through the stage labels; the real work is one request, but the
    // pipeline genuinely runs these steps in this order server-side.
    const timer = window.setInterval(() => {
      setStage((current) => Math.min(current + 1, STAGES.length - 1));
    }, 900);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div
      className="flex flex-col items-center justify-center py-16 text-center"
      role="status"
      aria-live="polite"
    >
      <div className="relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border border-border bg-muted">
        <ScanLine className="h-8 w-8 text-primary" aria-hidden="true" />
        <span
          className="absolute inset-x-0 h-px animate-scan-sweep bg-primary/70"
          aria-hidden="true"
        />
      </div>

      <p className="mt-6 text-base font-medium">{STAGES[stage]}</p>
      <p className="mt-1.5 text-sm text-muted-foreground">
        This usually takes a few seconds. Please keep this page open.
      </p>

      <Progress value={stage + 1} max={STAGES.length} className="mt-6 w-full max-w-xs" />
    </div>
  );
}

export function AnalysisResult({ result }: { result: ComplaintCreateResponse }) {
  const { success } = useToast();
  const complaint = result.complaint;
  const analysis = complaint.latest_analysis;
  const photo = complaint.images[0];

  function copyNumber() {
    void navigator.clipboard
      .writeText(complaint.complaint_number)
      .then(() => success("Complaint ID copied"));
  }

  return (
    <div className="space-y-6">
      {/* -- Confirmation ------------------------------------------------ */}
      <Card className="border-success/30 bg-success/5">
        <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-success/12">
            <CheckCircle2 className="h-6 w-6 text-success" aria-hidden="true" />
          </span>

          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">Your report has been submitted.</h2>
            <p className="mt-1 text-sm text-muted-foreground">{result.next_step}</p>
          </div>

          <div className="shrink-0 text-left sm:text-right">
            <p className="text-xs text-muted-foreground">Complaint ID</p>
            <button
              type="button"
              onClick={copyNumber}
              className="mt-0.5 inline-flex items-center gap-1.5 rounded-md font-mono text-base font-semibold hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {complaint.complaint_number}
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="sr-only">Copy complaint ID</span>
            </button>
          </div>
        </CardContent>
      </Card>

      {result.ai_message ? (
        <Alert variant="warning" title="AI analysis was inconclusive">
          <p>{result.ai_message}</p>
        </Alert>
      ) : null}

      {result.duplicate_candidates.length > 0 ? (
        <Alert variant="info" title="This may be the same road issue">
          <p>
            {result.duplicate_candidates.length === 1
              ? "One nearby report looks like it could be the same problem."
              : `${result.duplicate_candidates.length} nearby reports look like they could be the same problem.`}{" "}
            Nothing has been deleted - an administrator will review and link them if they match.
          </p>
          <ul className="mt-2 space-y-1">
            {result.duplicate_candidates.slice(0, 3).map((candidate) => (
              <li key={candidate.complaint_id} className="flex items-center gap-2 text-xs">
                <Layers className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <Link
                  href={`/reports/${candidate.complaint_id}`}
                  className="font-mono text-primary hover:underline"
                >
                  {candidate.complaint_number}
                </Link>
                <span className="text-muted-foreground">
                  {Math.round(candidate.distance_meters)}m away
                </span>
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        {/* -- AI analysis ---------------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle>AI analysis</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {photo ? (
              <DetectionOverlay
                imageUrl={photo.url}
                alt={`The ${DAMAGE_TYPE_LABELS[complaint.damage_type].toLowerCase()} you reported`}
                detections={analysis?.detections ?? []}
              />
            ) : (
              <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
                No photo was submitted with this report.
              </p>
            )}

            {analysis ? (
              <dl className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-border p-3">
                  <dt className="text-xs text-muted-foreground">Damage type</dt>
                  <dd className="mt-1.5">
                    <DamageTypeBadge type={analysis.damage_type} showIcon={false} />
                  </dd>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <dt className="text-xs text-muted-foreground">Confidence</dt>
                  <dd className="mt-1 text-xl font-semibold tabular-nums">
                    {Math.round(analysis.confidence * 100)}%
                  </dd>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <dt className="text-xs text-muted-foreground">Visual severity</dt>
                  <dd className="mt-1 text-xl font-semibold tabular-nums">
                    {analysis.severity_score.toFixed(1)}
                    <span className="text-sm font-normal text-muted-foreground">/10</span>
                  </dd>
                </div>
              </dl>
            ) : null}

            {analysis?.severity_explanation ? (
              <p className="text-sm leading-relaxed text-muted-foreground">
                {analysis.severity_explanation}
              </p>
            ) : null}

            <p className="flex items-start gap-2 border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{SEVERITY_DISCLAIMER}</span>
            </p>
          </CardContent>
        </Card>

        {/* -- Priority -------------------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle>Priority calculation</CardTitle>
          </CardHeader>
          <CardContent>
            {complaint.priority ? (
              <PriorityBreakdown assessment={complaint.priority} />
            ) : (
              <p className="text-sm text-muted-foreground">
                This report has not been scored yet. It will be reviewed manually.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* -- Summary ------------------------------------------------------ */}
      <Card>
        <CardHeader>
          <CardTitle>Report summary</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Status</dt>
              <dd className="mt-1.5">
                <StatusBadge status={complaint.status} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Location</dt>
              <dd className="mt-1 font-mono text-sm tabular-nums">
                {formatCoordinate(complaint.latitude)}, {formatCoordinate(complaint.longitude)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Road</dt>
              <dd className="mt-1 text-sm">{complaint.road_name ?? "Not specified"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Nearby facilities</dt>
              <dd className="mt-1 text-sm">
                {complaint.nearby_places.length > 0
                  ? `${complaint.nearby_places.length} within 500m`
                  : "None within 500m"}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button asChild>
          <Link href={`/reports/${complaint.id}`}>
            View this report
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/my-reports">Go to my reports</Link>
        </Button>
        <Button asChild variant="ghost">
          <Link href="/report">Report another problem</Link>
        </Button>
      </div>
    </div>
  );
}
