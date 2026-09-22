"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  ExternalLink,
  Flag,
  ImagePlus,
  MapPin,
  Play,
  Siren,
  X,
} from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { DamageTypeBadge, PriorityBadge } from "@/components/complaints/badges";
import { ContextPanel } from "@/components/complaints/context-panel";
import { PriorityBreakdown } from "@/components/complaints/priority-breakdown";
import { PageHeading } from "@/components/dashboard/dashboard-shell";
import { ErrorState, PanelSkeleton } from "@/components/shared/states";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { AssignmentStatusBadge } from "@/features/team/task-card";
import { ApiError, api, apiRequest, errorMessage } from "@/lib/api";
import {
  ACCEPTED_IMAGE_TYPES,
  ASSIGNMENT_FLAG_REASONS,
  EMERGENCY_REASONS,
  MAX_UPLOAD_MB,
  PRIORITY_DISCLAIMER,
  SEVERITY_DISCLAIMER,
} from "@/lib/constants";
import { shrinkForUpload } from "@/lib/shrink-image";
import { formatCoordinate, formatDateTime } from "@/lib/utils";
import type { ComplaintDetail, RepairDetails, Task } from "@/types";

/** `GET /team/tasks/:id` always returns the enriched detail (see toTaskDetail); this narrows the union for the pieces that need it. */
function isComplaintDetail(complaint: Task["complaint"]): complaint is ComplaintDetail {
  return "priority" in complaint;
}

export function TaskDetail({ assignmentId }: { assignmentId: string }) {
  const query = useQuery({
    queryKey: ["team", "task", assignmentId],
    queryFn: () => api.get<Task>(`/team/tasks/${assignmentId}`),
  });

  const thumbnailUrl = query.data?.complaint.thumbnail_url;
  const [imageFailed, setImageFailed] = React.useState(false);
  // Resets when the photo itself changes, computed during render (not an
  // effect) so it never lags a render behind - see the React docs' "Adjusting
  // some state when a prop changes".
  const [trackedUrl, setTrackedUrl] = React.useState(thumbnailUrl);
  if (thumbnailUrl !== trackedUrl) {
    setTrackedUrl(thumbnailUrl);
    setImageFailed(false);
  }

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
  const detail = isComplaintDetail(complaint) ? complaint : null;

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
        {task.is_emergency ? (
          <Badge variant="destructive" className="gap-1">
            <Siren className="h-3 w-3" aria-hidden="true" />
            Emergency
          </Badge>
        ) : null}
        {task.is_overdue ? <Badge variant="destructive">Overdue</Badge> : null}
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
              {complaint.thumbnail_url && !imageFailed ? (
                // User-submitted photo of unknown dimensions; a plain img keeps
                // the aspect handling simple.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={complaint.thumbnail_url}
                  alt={`Photo submitted with report ${complaint.complaint_number}`}
                  className="w-full rounded-lg border border-border object-cover"
                  onError={() => setImageFailed(true)}
                />
              ) : complaint.thumbnail_url ? (
                <div className="flex h-40 w-full items-center justify-center rounded-lg border border-border bg-muted text-sm text-muted-foreground">
                  Photo could not be loaded
                </div>
              ) : null}

              <p className="text-sm leading-relaxed">
                {complaint.description ?? "No description was provided for this report."}
              </p>

              <p className="text-xs text-muted-foreground">{SEVERITY_DISCLAIMER}</p>
            </CardContent>
          </Card>

          {detail?.priority ? (
            <Card>
              <CardHeader>
                <CardTitle>Why this score</CardTitle>
              </CardHeader>
              <CardContent>
                <PriorityBreakdown assessment={detail.priority} showHeader={false} />
              </CardContent>
            </Card>
          ) : null}

          <TaskActions task={task} />

          {task.evidence.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Before / after</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Before
                    </p>
                    {complaint.thumbnail_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={complaint.thumbnail_url}
                        alt={`Road condition reported in ${complaint.complaint_number}, before repair`}
                        className="aspect-square w-full rounded-lg border border-border object-cover"
                      />
                    ) : (
                      <div className="flex aspect-square w-full items-center justify-center rounded-lg border border-border bg-muted text-xs text-muted-foreground">
                        No photo was submitted
                      </div>
                    )}
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      After
                    </p>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={task.evidence[0].url}
                      alt={task.evidence[0].note ?? "Repaired road"}
                      className="aspect-square w-full rounded-lg border border-border object-cover"
                    />
                  </div>
                </div>

                {task.evidence.length > 1 ? (
                  <div>
                    <p className="mb-2 text-xs text-muted-foreground">
                      {task.evidence.length - 1} more after photo
                      {task.evidence.length - 1 === 1 ? "" : "s"}
                    </p>
                    <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                      {task.evidence.slice(1).map((item) => (
                        <li key={item.id}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={item.url}
                            alt={item.note ?? "Photo submitted as completion evidence"}
                            className="aspect-square w-full rounded-lg border border-border object-cover"
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {task.repair_details ? <RepairDetailsCard details={task.repair_details} /> : null}

          {detail ? (
            <Card>
              <CardHeader>
                <CardTitle>Context</CardTitle>
              </CardHeader>
              <CardContent>
                <ContextPanel complaint={detail} />
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
                {task.rework_count > 0 ? (
                  <Row label="Sent back for rework" value={`${task.rework_count} time${task.rework_count === 1 ? "" : "s"}`} />
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

function RepairDetailsCard({ details }: { details: RepairDetails }) {
  const rows: { label: string; value: string }[] = [];
  if (details.repair_type) rows.push({ label: "Repair type", value: details.repair_type });
  if (details.materials) rows.push({ label: "Materials", value: details.materials });
  if (details.quantity) rows.push({ label: "Quantity", value: details.quantity });
  if (details.equipment) rows.push({ label: "Equipment", value: details.equipment });
  if (details.workers_count !== null) {
    rows.push({ label: "Workers", value: String(details.workers_count) });
  }
  if (details.cost_amount !== null) {
    rows.push({ label: "Approximate cost", value: `₹${details.cost_amount.toLocaleString()}` });
  }
  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Repair details</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          {rows.map((row) => (
            <div key={row.label}>
              <dt className="text-xs text-muted-foreground">{row.label}</dt>
              <dd className="font-medium">{row.value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
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

/** Combines a reason-code dropdown with optional free text into the one string the server stores (same shape `rejectComplaint` already uses). */
function composeReason(reasonCode: string, note: string): string {
  const trimmedNote = note.trim();
  if (reasonCode === "Other") return trimmedNote;
  return trimmedNote ? `${reasonCode}: ${trimmedNote}` : reasonCode;
}

function FlagAssignmentDialog({
  task,
  open,
  onOpenChange,
  onDone,
}: {
  task: Task;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const { error: toastError } = useToast();
  const [reasonCode, setReasonCode] = React.useState(ASSIGNMENT_FLAG_REASONS[0].value);
  const [note, setNote] = React.useState("");
  const reason = composeReason(reasonCode, note);
  const valid = reason.trim().length >= 3;

  const mutation = useMutation({
    mutationFn: () => api.post(`/team/tasks/${task.id}/flag`, { reason }),
    onSuccess: () => {
      setNote("");
      onDone();
    },
    onError: (error) => toastError("Could not report a problem", errorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report a problem with this assignment</DialogTitle>
          <DialogDescription>
            This ends the job for your crew and puts the report back in the admin queue,
            unassigned, so it can be looked at.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field id="flag-reason" label="What's wrong" required>
            <Select value={reasonCode} onValueChange={setReasonCode}>
              <SelectTrigger id="flag-reason">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ASSIGNMENT_FLAG_REASONS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field
            id="flag-note"
            label="Details"
            required={reasonCode === "Other"}
            hint={reasonCode === "Other" ? undefined : "Optional, but helpful for whoever reassigns it."}
          >
            <Textarea
              id="flag-note"
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              aria-describedby="flag-note-hint"
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !valid}
          >
            {mutation.isPending ? "Reporting..." : "Report problem"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EscalateDialog({
  task,
  open,
  onOpenChange,
  onDone,
}: {
  task: Task;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const { error: toastError } = useToast();
  const [reasonCode, setReasonCode] = React.useState(EMERGENCY_REASONS[0].value);
  const [note, setNote] = React.useState("");
  const reason = composeReason(reasonCode, note);
  const valid = reason.trim().length >= 3;

  const mutation = useMutation({
    mutationFn: () => api.post(`/team/tasks/${task.id}/escalate`, { reason }),
    onSuccess: () => {
      setNote("");
      onDone();
    },
    onError: (error) => toastError("Could not escalate this job", errorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark as an emergency</DialogTitle>
          <DialogDescription>
            Raises this report to the top of every admin&rsquo;s queue and notifies them
            immediately - use it for a hazard you can see is worse than the score suggests.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field id="escalate-reason" label="Why" required>
            <Select value={reasonCode} onValueChange={setReasonCode}>
              <SelectTrigger id="escalate-reason">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EMERGENCY_REASONS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field
            id="escalate-note"
            label="Details"
            required={reasonCode === "Other"}
            hint={reasonCode === "Other" ? undefined : "Optional. Shown to every admin."}
          >
            <Textarea
              id="escalate-note"
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              aria-describedby="escalate-note-hint"
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !valid}
          >
            {mutation.isPending ? "Escalating..." : "Mark as emergency"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "Report a problem" / "Mark as emergency" - available for any open job, alongside whatever the main action card offers. */
function SecondaryActions({ task, onChanged }: { task: Task; onChanged: () => void }) {
  const [dialog, setDialog] = React.useState<null | "flag" | "escalate">(null);

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => setDialog("flag")}>
          <Flag aria-hidden="true" />
          Report a problem
        </Button>
        {!task.is_emergency ? (
          <Button variant="outline" size="sm" onClick={() => setDialog("escalate")}>
            <Siren aria-hidden="true" />
            Mark as emergency
          </Button>
        ) : null}
      </div>

      <FlagAssignmentDialog
        task={task}
        open={dialog === "flag"}
        onOpenChange={(value) => setDialog(value ? "flag" : null)}
        onDone={() => {
          setDialog(null);
          onChanged();
        }}
      />
      <EscalateDialog
        task={task}
        open={dialog === "escalate"}
        onOpenChange={(value) => setDialog(value ? "escalate" : null)}
        onDone={() => {
          setDialog(null);
          onChanged();
        }}
      />
    </>
  );
}

/** Start and complete: the main things a crew changes about a job. */
function TaskActions({ task }: { task: Task }) {
  const queryClient = useQueryClient();
  const { success, error: toastError } = useToast();

  const [note, setNote] = React.useState("");
  const [photos, setPhotos] = React.useState<File[]>([]);
  const [fileError, setFileError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const [repairType, setRepairType] = React.useState("");
  const [materials, setMaterials] = React.useState("");
  const [quantity, setQuantity] = React.useState("");
  const [equipment, setEquipment] = React.useState("");
  const [workersCount, setWorkersCount] = React.useState("");
  const [costAmount, setCostAmount] = React.useState("");

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
    mutationFn: async () => {
      const form = new FormData();
      if (note.trim()) form.append("note", note.trim());
      if (repairType.trim()) form.append("repair_type", repairType.trim());
      if (materials.trim()) form.append("materials", materials.trim());
      if (quantity.trim()) form.append("quantity", quantity.trim());
      if (equipment.trim()) form.append("equipment", equipment.trim());
      if (workersCount.trim()) form.append("workers_count", workersCount.trim());
      if (costAmount.trim()) form.append("cost_amount", costAmount.trim());
      for (const file of await Promise.all(photos.map(shrinkForUpload))) {
        form.append("photos", file);
      }
      return apiRequest<Task>(`/team/tasks/${task.id}/complete`, { method: "POST", body: form });
    },
    onSuccess: () => {
      setNote("");
      setPhotos([]);
      setRepairType("");
      setMaterials("");
      setQuantity("");
      setEquipment("");
      setWorkersCount("");
      setCostAmount("");
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
    return task.flag_reason ? (
      <Alert variant="warning" title="You reported a problem with this assignment">
        {task.flag_reason} An administrator has been notified and the report is back in the
        queue, unassigned.
      </Alert>
    ) : (
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
      <div className="space-y-3">
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
        <SecondaryActions task={task} onChanged={invalidate} />
      </div>
    );
  }

  // IN_PROGRESS - the completion form.
  return (
    <div className="space-y-3">
      {task.rework_count > 0 ? (
        <Alert variant="warning" title="Rework requested">
          The works department sent this back{task.rework_reason ? `: ${task.rework_reason}` : "."}{" "}
          Please fix it and submit again.
        </Alert>
      ) : null}

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

            <div className="space-y-3 rounded-lg border border-border p-3">
              <p className="text-sm font-medium">Repair details</p>
              <p className="text-xs text-muted-foreground">
                Optional. Helps the works department and future analytics, not required to submit.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field id="repair-type" label="Repair type" className="space-y-1.5">
                  <Input
                    id="repair-type"
                    value={repairType}
                    onChange={(event) => setRepairType(event.target.value)}
                    placeholder="e.g. Pothole filling"
                  />
                </Field>
                <Field id="repair-materials" label="Materials" className="space-y-1.5">
                  <Input
                    id="repair-materials"
                    value={materials}
                    onChange={(event) => setMaterials(event.target.value)}
                    placeholder="e.g. Asphalt"
                  />
                </Field>
                <Field id="repair-quantity" label="Quantity" className="space-y-1.5">
                  <Input
                    id="repair-quantity"
                    value={quantity}
                    onChange={(event) => setQuantity(event.target.value)}
                    placeholder="e.g. 25 kg"
                  />
                </Field>
                <Field id="repair-equipment" label="Equipment" className="space-y-1.5">
                  <Input
                    id="repair-equipment"
                    value={equipment}
                    onChange={(event) => setEquipment(event.target.value)}
                    placeholder="e.g. Road roller"
                  />
                </Field>
                <Field id="repair-workers" label="Workers" className="space-y-1.5">
                  <Input
                    id="repair-workers"
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={workersCount}
                    onChange={(event) => setWorkersCount(event.target.value)}
                  />
                </Field>
                <Field id="repair-cost" label="Approximate cost (₹)" className="space-y-1.5">
                  <Input
                    id="repair-cost"
                    type="number"
                    min={0}
                    inputMode="decimal"
                    value={costAmount}
                    onChange={(event) => setCostAmount(event.target.value)}
                  />
                </Field>
              </div>
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

      <SecondaryActions task={task} onChanged={invalidate} />
    </div>
  );
}
