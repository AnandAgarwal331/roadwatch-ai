"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  ExternalLink,
  ImagePlus,
  MapPin,
  Play,
  X,
} from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { DamageTypeBadge, PriorityBadge } from "@/components/complaints/badges";
import { PageHeading } from "@/components/dashboard/dashboard-shell";
import { ErrorState, PanelSkeleton } from "@/components/shared/states";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { AssignmentStatusBadge } from "@/features/team/task-card";
import { ApiError, api, apiRequest, errorMessage } from "@/lib/api";
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_UPLOAD_MB,
  PRIORITY_DISCLAIMER,
  SEVERITY_DISCLAIMER,
} from "@/lib/constants";
import { formatCoordinate, formatDateTime } from "@/lib/utils";
import type { Task } from "@/types";

export function TaskDetail({ assignmentId }: { assignmentId: string }) {
  const query = useQuery({
    queryKey: ["team", "task", assignmentId],
    queryFn: () => api.get<Task>(`/team/tasks/${assignmentId}`),
  });

  if (query.isPending) {
    return (
      <>
        <PageHeading title="Job" />
        <PanelSkeleton />
      </>
    );
  }

  if (query.isError) {
    return (
      <>
        <PageHeading title="Job" />
        <ErrorState
          title="Could not load this job"
          description={errorMessage(query.error)}
          onRetry={() => query.refetch()}
        />
      </>
    );
  }

  const task = query.data;
  const { complaint } = task;

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2">
        <Link href="/team/tasks">
          <ArrowLeft aria-hidden="true" />
          Back to jobs
        </Link>
      </Button>

      <PageHeading
        title={complaint.road_name ?? "Unnamed road"}
        description={`Report ${complaint.complaint_number}`}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={`/reports/${complaint.id}`}>
              Public report
              <ExternalLink aria-hidden="true" />
            </Link>
          </Button>
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <PriorityBadge level={complaint.priority_level} score={complaint.priority_score} />
        <DamageTypeBadge type={complaint.damage_type} />
        <AssignmentStatusBadge task={task} />
        {task.is_overdue ? (
          <Badge variant="destructive">Overdue</Badge>
        ) : null}
        {complaint.report_count > 1 ? (
          <Badge variant="muted">{complaint.report_count} reports of this problem</Badge>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>What was reported</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {complaint.thumbnail_url ? (
                // User-submitted photo of unknown dimensions; a plain img keeps
                // the aspect handling simple.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={complaint.thumbnail_url}
                  alt={`Photo submitted with report ${complaint.complaint_number}`}
                  className="w-full rounded-lg border border-border object-cover"
                />
              ) : null}

              <p className="text-sm leading-relaxed">
                {complaint.description ?? "No description was provided for this report."}
              </p>

              <p className="text-xs text-muted-foreground">{SEVERITY_DISCLAIMER}</p>
            </CardContent>
          </Card>

          <TaskActions task={task} />

          {task.evidence.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Completion evidence</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="grid gap-3 sm:grid-cols-3">
                  {task.evidence.map((item) => (
                    <li key={item.id}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.url}
                        alt={item.note ?? "Photo submitted as completion evidence"}
                        className="aspect-square w-full rounded-lg border border-border object-cover"
                      />
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatDateTime(item.created_at)}
                      </p>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Where</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="flex items-start gap-2">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span>{complaint.road_name ?? "No road name recorded"}</span>
              </p>
              <p className="font-mono text-xs text-muted-foreground">
                {formatCoordinate(complaint.latitude)}, {formatCoordinate(complaint.longitude)}
              </p>
              <Button asChild variant="outline" size="sm" className="w-full">
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${complaint.latitude},${complaint.longitude}`}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Open directions
                  <ExternalLink aria-hidden="true" />
                </a>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Schedule</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3 text-sm">
                <Row label="Assigned" value={formatDateTime(task.created_at)} />
                <Row
                  label="Due"
                  value={task.due_at ? formatDateTime(task.due_at) : "No due date set"}
                  emphasis={task.is_overdue}
                />
                {task.started_at ? (
                  <Row label="Started" value={formatDateTime(task.started_at)} />
                ) : null}
                {task.completed_at ? (
                  <Row label="Completed" value={formatDateTime(task.completed_at)} />
                ) : null}
                {task.verified_at ? (
                  <Row label="Verified" value={formatDateTime(task.verified_at)} />
                ) : null}
              </dl>
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">{PRIORITY_DISCLAIMER}</p>
        </aside>
      </div>
    </>
  );
}

function Row({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={emphasis ? "text-right font-medium text-destructive" : "text-right"}>
        {value}
      </dd>
    </div>
  );
}

/** Start and complete: the only two things a crew changes about a job. */
function TaskActions({ task }: { task: Task }) {
  const queryClient = useQueryClient();
  const { success, error: toastError } = useToast();

  const [note, setNote] = React.useState("");
  const [photos, setPhotos] = React.useState<File[]>([]);
  const [fileError, setFileError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Object URLs must be revoked or the previews leak for the page's lifetime.
  const previews = React.useMemo(
    () => photos.map((file) => ({ file, url: URL.createObjectURL(file) })),
    [photos],
  );
  React.useEffect(() => {
    return () => previews.forEach((item) => URL.revokeObjectURL(item.url));
  }, [previews]);

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ["team"] });
  }

  const start = useMutation({
    mutationFn: () => api.post<Task>(`/team/tasks/${task.id}/start`),
    onSuccess: () => {
      success("Job started", "The reporter has been notified that work is under way.");
      invalidate();
    },
    onError: (error) => toastError("Could not start the job", errorMessage(error)),
  });

  const complete = useMutation({
    mutationFn: () => {
      const form = new FormData();
      if (note.trim()) form.append("note", note.trim());
      photos.forEach((file) => form.append("photos", file));
      return apiRequest<Task>(`/team/tasks/${task.id}/complete`, { method: "POST", body: form });
    },
    onSuccess: () => {
      setNote("");
      setPhotos([]);
      success("Repair submitted", "The works department will verify it.");
      invalidate();
    },
    onError: (error) => {
      const message =
        error instanceof ApiError ? error.message : errorMessage(error);
      toastError("Could not submit the repair", message);
    },
  });

  function addFiles(list: FileList | null) {
    if (!list) return;
    const accepted: File[] = [];

    for (const file of Array.from(list)) {
      if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
        setFileError(`${file.name} is not a JPEG, PNG or WebP image.`);
        continue;
      }
      if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
        setFileError(
          `${file.name} is ${(file.size / (1024 * 1024)).toFixed(1)}MB. Please keep photos under ${MAX_UPLOAD_MB}MB.`,
        );
        continue;
      }
      accepted.push(file);
    }

    if (accepted.length) setFileError(null);
    setPhotos((current) => [...current, ...accepted]);
    // Reset so re-picking the same file still fires a change event.
    if (inputRef.current) inputRef.current.value = "";
  }

  if (task.status === "VERIFIED") {
    return (
      <Alert variant="success" title="Verified">
        The works department verified this repair on {formatDateTime(task.verified_at)}. Nothing
        further is needed.
      </Alert>
    );
  }

  if (task.status === "CANCELLED") {
    return (
      <Alert variant="warning" title="Cancelled">
        This job was cancelled and does not need to be carried out.
      </Alert>
    );
  }

  if (task.status === "COMPLETED") {
    return (
      <Alert variant="info" title="Awaiting verification">
        You submitted this repair on {formatDateTime(task.completed_at)}. The works department will
        check the evidence and close the report.
      </Alert>
    );
  }

  if (task.status === "ASSIGNED") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Start this job</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Mark the job as started when you arrive on site. The citizen who reported it is
            notified, and the report moves to &ldquo;in progress&rdquo;.
          </p>
          <Button onClick={() => start.mutate()} disabled={start.isPending}>
            <Play aria-hidden="true" />
            {start.isPending ? "Starting..." : "Start repair"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  // IN_PROGRESS - the completion form.
  return (
    <Card>
      <CardHeader>
        <CardTitle>Submit the completed repair</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            complete.mutate();
          }}
        >
          <div className="space-y-2">
            <label htmlFor="completion-note" className="text-sm font-medium">
              What was done
            </label>
            <Textarea
              id="completion-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={4}
              placeholder="e.g. Pothole cut out, filled with hot mix and compacted. Road reopened."
              aria-describedby="completion-note-hint"
            />
            <p id="completion-note-hint" className="text-xs text-muted-foreground">
              Optional, but it is what the works department reads when verifying.
            </p>
          </div>

          <div className="space-y-2">
            <span className="text-sm font-medium">Photos of the finished work</span>

            {previews.length > 0 ? (
              <ul className="grid grid-cols-3 gap-3">
                {previews.map((item, index) => (
                  <li key={item.url} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.url}
                      alt={`Selected photo ${index + 1}: ${item.file.name}`}
                      className="aspect-square w-full rounded-lg border border-border object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => setPhotos((current) => current.filter((_, i) => i !== index))}
                      aria-label={`Remove ${item.file.name}`}
                      className="absolute right-1 top-1 rounded-full bg-background/90 p-1 text-foreground shadow-card hover:bg-background"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            <input
              ref={inputRef}
              id="completion-photos"
              type="file"
              multiple
              accept={ACCEPTED_IMAGE_TYPES.join(",")}
              className="sr-only"
              onChange={(event) => addFiles(event.target.files)}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => inputRef.current?.click()}
              className="w-full"
            >
              <ImagePlus aria-hidden="true" />
              Add photos
            </Button>
            <p className="text-xs text-muted-foreground">
              JPEG, PNG or WebP &middot; up to {MAX_UPLOAD_MB}MB each
            </p>

            {fileError ? (
              <p role="alert" className="text-xs font-medium text-destructive">
                {fileError}
              </p>
            ) : null}
          </div>

          <Button type="submit" disabled={complete.isPending}>
            <CheckCircle2 aria-hidden="true" />
            {complete.isPending ? "Submitting..." : "Mark as complete"}
          </Button>

          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            The report stays open until the works department verifies the repair.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
