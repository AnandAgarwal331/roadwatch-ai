"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Ban, Siren, SlidersHorizontal, Trash2, Undo2, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import { EvidenceImage } from "@/components/complaints/evidence-image";
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
import { api, errorMessage } from "@/lib/api";
import { STATUS_LABELS } from "@/lib/constants";
import { formatDateTime } from "@/lib/utils";
import type { ComplaintDetail, ComplaintStatus, RepairTeamWithLoad } from "@/types";

/** Statuses an administrator can move a report to by hand. */
const SETTABLE: ComplaintStatus[] = [
  "PENDING",
  "AI_ANALYZED",
  "PRIORITIZED",
  "ASSIGNED",
  "IN_PROGRESS",
  "RESOLVED",
];

/**
 * Everything an administrator can do to a report, in one panel.
 *
 * Each action is a small dialog rather than an inline control: they all write
 * to the audit trail and several notify the reporter, so a deliberate
 * confirm-and-explain step is the right shape.
 */
export function AdminActions({ complaint }: { complaint: ComplaintDetail }) {
  const queryClient = useQueryClient();
  const { success, error: toastError } = useToast();

  const [open, setOpen] = React.useState<
    null | "status" | "reject" | "priority" | "assign" | "verify" | "reject_repair" | "delete"
  >(null);

  function done(message: string, detail?: string) {
    success(message, detail);
    setOpen(null);
    void queryClient.invalidateQueries({ queryKey: ["admin"] });
  }

  function failed(title: string) {
    return (error: unknown) => toastError(title, errorMessage(error));
  }

  const awaitingVerification = complaint.assignment?.status === "COMPLETED";
  const closed = complaint.status === "REJECTED" || complaint.status === "DUPLICATE";

  return (
    <>
      {complaint.assignment ? (
        <Card>
          <CardHeader>
            <CardTitle>Current assignment</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">State</dt>
                <dd className="font-medium">{complaint.assignment.status}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Due</dt>
                <dd>
                  {complaint.assignment.due_at
                    ? formatDateTime(complaint.assignment.due_at)
                    : "Not set"}
                </dd>
              </div>
              {complaint.assignment.completed_at ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Completed</dt>
                  <dd>{formatDateTime(complaint.assignment.completed_at)}</dd>
                </div>
              ) : null}
              {complaint.assignment.rework_count > 0 ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Sent back for rework</dt>
                  <dd>
                    {complaint.assignment.rework_count} time
                    {complaint.assignment.rework_count === 1 ? "" : "s"}
                  </dd>
                </div>
              ) : null}
            </dl>

            {complaint.assignment.notes ? (
              <div className="mt-3 rounded-lg bg-muted/60 p-2.5 text-sm">
                <p className="text-xs font-medium text-muted-foreground">What the crew reported</p>
                <p className="mt-1 leading-relaxed">{complaint.assignment.notes}</p>
              </div>
            ) : null}

            {complaint.assignment.evidence.length > 0 ? (
              <div className="mt-3">
                <p className="text-xs font-medium text-muted-foreground">
                  Evidence submitted ({complaint.assignment.evidence.length} photo
                  {complaint.assignment.evidence.length === 1 ? "" : "s"})
                </p>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {complaint.assignment.evidence.map((item) => (
                    <a
                      key={item.id}
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block overflow-hidden rounded-md border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <EvidenceImage
                        src={item.url}
                        alt={item.note ?? "Photo submitted as completion evidence"}
                        className="aspect-square w-full object-cover transition-transform duration-200 hover:scale-105"
                      />
                    </a>
                  ))}
                </div>
              </div>
            ) : complaint.assignment.status === "COMPLETED" || complaint.assignment.status === "VERIFIED" ? (
              <p className="mt-3 text-xs text-muted-foreground">
                No evidence photos were attached to this submission.
              </p>
            ) : null}

            {complaint.assignment.is_emergency ? (
              <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive">
                <Siren className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>
                  The crew marked this an emergency
                  {complaint.assignment.emergency_reason ? `: ${complaint.assignment.emergency_reason}` : "."}
                </span>
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {closed ? (
            <p className="text-sm text-muted-foreground">
              This report is closed. Reopen it by changing its status.
            </p>
          ) : null}

          {awaitingVerification ? (
            <Button className="w-full justify-start" onClick={() => setOpen("verify")}>
              <BadgeCheck aria-hidden="true" />
              Verify the repair
            </Button>
          ) : null}

          {awaitingVerification ? (
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => setOpen("reject_repair")}
            >
              <Undo2 aria-hidden="true" />
              Send back for rework
            </Button>
          ) : null}

          <Button
            variant="outline"
            className="w-full justify-start"
            onClick={() => setOpen("assign")}
          >
            <UserPlus aria-hidden="true" />
            {complaint.assignment ? "Reassign to a crew" : "Assign to a crew"}
          </Button>

          <Button
            variant="outline"
            className="w-full justify-start"
            onClick={() => setOpen("status")}
          >
            Change status
          </Button>

          <Button
            variant="outline"
            className="w-full justify-start"
            onClick={() => setOpen("priority")}
          >
            <SlidersHorizontal aria-hidden="true" />
            Override priority
          </Button>

          {!closed ? (
            <Button
              variant="ghost"
              className="w-full justify-start text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setOpen("reject")}
            >
              <Ban aria-hidden="true" />
              Reject this report
            </Button>
          ) : null}

          <Button
            variant="ghost"
            className="w-full justify-start text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setOpen("delete")}
          >
            <Trash2 aria-hidden="true" />
            Delete this report
          </Button>
        </CardContent>
      </Card>

      <StatusDialog
        complaint={complaint}
        open={open === "status"}
        onOpenChange={(value) => setOpen(value ? "status" : null)}
        onDone={done}
        onError={failed("Could not change the status")}
      />
      <RejectDialog
        complaint={complaint}
        open={open === "reject"}
        onOpenChange={(value) => setOpen(value ? "reject" : null)}
        onDone={done}
        onError={failed("Could not reject the report")}
      />
      <PriorityDialog
        complaint={complaint}
        open={open === "priority"}
        onOpenChange={(value) => setOpen(value ? "priority" : null)}
        onDone={done}
        onError={failed("Could not override the priority")}
      />
      <AssignDialog
        complaint={complaint}
        open={open === "assign"}
        onOpenChange={(value) => setOpen(value ? "assign" : null)}
        onDone={done}
        onError={failed("Could not assign the report")}
      />
      <VerifyDialog
        complaint={complaint}
        open={open === "verify"}
        onOpenChange={(value) => setOpen(value ? "verify" : null)}
        onDone={done}
        onError={failed("Could not verify the repair")}
      />
      <RejectRepairDialog
        complaint={complaint}
        open={open === "reject_repair"}
        onOpenChange={(value) => setOpen(value ? "reject_repair" : null)}
        onDone={done}
        onError={failed("Could not send the repair back")}
      />
      <DeleteReportDialog
        complaint={complaint}
        open={open === "delete"}
        onOpenChange={(value) => setOpen(value ? "delete" : null)}
      />
    </>
  );
}

interface DialogProps {
  complaint: ComplaintDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: (message: string, detail?: string) => void;
  onError: (error: unknown) => void;
}

function StatusDialog({ complaint, open, onOpenChange, onDone, onError }: DialogProps) {
  const [status, setStatus] = React.useState<ComplaintStatus>(complaint.status);
  const [note, setNote] = React.useState("");

  const mutation = useMutation({
    mutationFn: () =>
      api.patch<ComplaintDetail>(`/admin/reports/${complaint.id}/status`, {
        status,
        note: note.trim() || null,
      }),
    onSuccess: () => onDone("Status changed", "The reporter has been notified."),
    onError,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change status</DialogTitle>
          <DialogDescription>
            The citizen who reported this is notified of the change, and it is written to the audit
            trail against your account.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field id="new-status" label="New status" required>
            <Select value={status} onValueChange={(value) => setStatus(value as ComplaintStatus)}>
              <SelectTrigger id="new-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SETTABLE.map((item) => (
                  <SelectItem key={item} value={item}>
                    {STATUS_LABELS[item]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field id="status-note" label="Note" hint="Optional. Shown in the report history.">
            <Textarea
              id="status-note"
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              aria-describedby="status-note-hint"
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || status === complaint.status}
          >
            {mutation.isPending ? "Saving..." : "Change status"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RejectDialog({ complaint, open, onOpenChange, onDone, onError }: DialogProps) {
  const [reason, setReason] = React.useState("");

  const mutation = useMutation({
    mutationFn: () =>
      api.post<ComplaintDetail>(`/admin/reports/${complaint.id}/reject`, {
        reason: reason.trim(),
      }),
    onSuccess: () => onDone("Report rejected", "The reason was sent to the reporter."),
    onError,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject this report</DialogTitle>
          <DialogDescription>
            Rejecting hides the report from the public feed. The reason you give is sent to the
            person who reported it, so write it for them.
          </DialogDescription>
        </DialogHeader>

        <Field
          id="reject-reason"
          label="Reason"
          required
          hint="At least 3 characters. For example: this location is a private road and falls outside the council's remit."
        >
          <Textarea
            id="reject-reason"
            rows={4}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            aria-describedby="reject-reason-hint"
          />
        </Field>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || reason.trim().length < 3}
          >
            {mutation.isPending ? "Rejecting..." : "Reject report"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PriorityDialog({ complaint, open, onOpenChange, onDone, onError }: DialogProps) {
  const [score, setScore] = React.useState(String(Math.round(complaint.priority_score)));
  const [note, setNote] = React.useState("");

  const numeric = Number(score);
  const valid = Number.isFinite(numeric) && numeric >= 0 && numeric <= 100;

  const mutation = useMutation({
    mutationFn: () =>
      api.patch<ComplaintDetail>(`/admin/reports/${complaint.id}/priority`, {
        priority_score: numeric,
        note: note.trim() || null,
      }),
    onSuccess: () => onDone("Priority overridden"),
    onError,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Override the recommended priority</DialogTitle>
          <DialogDescription>
            The engine recommended {complaint.priority_score.toFixed(1)}. An override replaces that
            score until the assessment is re-run, and the report is marked as overridden wherever it
            appears.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field
            id="override-score"
            label="Priority score"
            required
            hint="0 to 100."
            error={!valid && score !== "" ? "Enter a number between 0 and 100." : undefined}
          >
            <Input
              id="override-score"
              type="number"
              min={0}
              max={100}
              step={1}
              value={score}
              onChange={(event) => setScore(event.target.value)}
              aria-describedby="override-score-hint"
            />
          </Field>

          <Field
            id="override-note"
            label="Why"
            hint="Optional, but this is what a later reviewer reads in the audit trail."
          >
            <Textarea
              id="override-note"
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              aria-describedby="override-note-hint"
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !valid}>
            {mutation.isPending ? "Saving..." : "Override priority"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssignDialog({ complaint, open, onOpenChange, onDone, onError }: DialogProps) {
  const [teamId, setTeamId] = React.useState<string>(complaint.assignment?.team_id ?? "");
  const [dueAt, setDueAt] = React.useState("");
  const [note, setNote] = React.useState("");

  const teams = useQuery({
    queryKey: ["admin", "teams"],
    queryFn: () => api.get<RepairTeamWithLoad[]>("/admin/teams"),
    // Only fetched when the dialog is actually opened.
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/admin/reports/${complaint.id}/assign`, {
        team_id: teamId,
        // datetime-local has no zone; send it as the browser's local instant.
        due_at: dueAt ? new Date(dueAt).toISOString() : null,
        note: note.trim() || null,
      }),
    onSuccess: () => onDone("Assigned", "The crew can see the job in their console."),
    onError,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign to a repair crew</DialogTitle>
          <DialogDescription>
            The crew sees the job immediately, and the reporter is told that work has been
            scheduled.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field id="assign-team" label="Crew" required>
            <Select value={teamId} onValueChange={setTeamId}>
              <SelectTrigger id="assign-team">
                <SelectValue placeholder={teams.isPending ? "Loading crews..." : "Choose a crew"} />
              </SelectTrigger>
              <SelectContent>
                {(teams.data ?? [])
                  .filter((team) => team.is_active)
                  .map((team) => (
                    <SelectItem key={team.id} value={team.id}>
                      {team.name} - {team.open_jobs}/{team.max_concurrent_jobs} jobs
                      {team.specialities ? ` - ${team.specialities}` : ""}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Field>

          <Field id="assign-due" label="Due by" hint="Optional. Crews see overdue jobs flagged.">
            <Input
              id="assign-due"
              type="datetime-local"
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
              aria-describedby="assign-due-hint"
            />
          </Field>

          <Field id="assign-note" label="Instructions" hint="Optional. Shown to the crew.">
            <Textarea
              id="assign-note"
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              aria-describedby="assign-note-hint"
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !teamId}>
            {mutation.isPending ? "Assigning..." : "Assign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VerifyDialog({ complaint, open, onOpenChange, onDone, onError }: DialogProps) {
  const [note, setNote] = React.useState("");
  const evidence = complaint.assignment?.evidence ?? [];

  const mutation = useMutation({
    mutationFn: () =>
      api.post<ComplaintDetail>(`/admin/reports/${complaint.id}/verify`, {
        note: note.trim() || null,
      }),
    onSuccess: () => onDone("Repair verified", "The report is now resolved."),
    onError,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Verify the repair</DialogTitle>
          <DialogDescription>
            Confirm the crew&rsquo;s evidence shows the problem fixed. This resolves the report and
            tells the person who reported it.
          </DialogDescription>
        </DialogHeader>

        {evidence.length > 0 ? (
          <div className="grid grid-cols-4 gap-2">
            {evidence.map((item) => (
              <EvidenceImage
                key={item.id}
                src={item.url}
                alt={item.note ?? "Photo submitted as completion evidence"}
                className="aspect-square w-full rounded-md border border-border object-cover"
              />
            ))}
          </div>
        ) : null}

        <Field id="verify-note" label="Note" hint="Optional. Recorded against the verification.">
          <Textarea
            id="verify-note"
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            aria-describedby="verify-note-hint"
          />
        </Field>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? "Verifying..." : "Verify repair"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RejectRepairDialog({ complaint, open, onOpenChange, onDone, onError }: DialogProps) {
  const [reason, setReason] = React.useState("");
  const valid = reason.trim().length >= 3;
  const evidence = complaint.assignment?.evidence ?? [];

  const mutation = useMutation({
    mutationFn: () =>
      api.post<ComplaintDetail>(`/admin/reports/${complaint.id}/reject-repair`, {
        reason: reason.trim(),
      }),
    onSuccess: () => {
      setReason("");
      onDone("Sent back for rework", "The crew has been notified and the job is open again.");
    },
    onError,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send the repair back for rework</DialogTitle>
          <DialogDescription>
            The crew&rsquo;s evidence does not show the problem fixed. The job reopens for the same
            crew, the evidence they submitted is cleared, and they are told why.
          </DialogDescription>
        </DialogHeader>

        {evidence.length > 0 ? (
          <div className="grid grid-cols-4 gap-2">
            {evidence.map((item) => (
              <EvidenceImage
                key={item.id}
                src={item.url}
                alt={item.note ?? "Photo submitted as completion evidence"}
                className="aspect-square w-full rounded-md border border-border object-cover"
              />
            ))}
          </div>
        ) : null}

        <Field
          id="reject-repair-reason"
          label="What still needs to be fixed"
          required
          hint="Sent to the crew, and recorded against the job."
          error={reason && !valid ? "Enter at least a few words." : undefined}
        >
          <Textarea
            id="reject-repair-reason"
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            aria-describedby="reject-repair-reason-hint"
          />
        </Field>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !valid}
          >
            {mutation.isPending ? "Sending back..." : "Send back for rework"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Soft delete: the row and its history stay in the database for an audit,
 * but disappear from every listing, the map and duplicate matching. Recovering
 * one needs a database operator - the dialog says so rather than implying
 * "Delete" is reversible from here.
 */
function DeleteReportDialog({
  complaint,
  open,
  onOpenChange,
}: {
  complaint: ComplaintDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [reason, setReason] = React.useState("");
  const valid = reason.trim().length >= 3;

  const mutation = useMutation({
    mutationFn: () => api.delete<{ message: string }>(`/admin/reports/${complaint.id}`, { reason: reason.trim() }),
    onSuccess: (result) => {
      success("Report deleted", result?.message);
      onOpenChange(false);
      router.push("/admin/reports");
    },
    onError: (error) => toastError("Could not delete this report", errorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {complaint.complaint_number}?</DialogTitle>
          <DialogDescription>
            Removes it from every listing, the map and duplicate matching, and notifies the
            reporter. The record itself is kept for audit - recovering it needs a database
            operator, so treat this as permanent.
            {complaint.assignment && complaint.assignment.status !== "VERIFIED" ? (
              <span className="mt-2 block font-medium text-destructive">
                A crew currently has this job open - it will be cancelled.
              </span>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <Field
          id="delete-report-reason"
          label="Reason"
          required
          hint="Recorded against the report, and sent to the person who reported it."
          error={reason && !valid ? "Enter at least a few words." : undefined}
        >
          <Textarea
            id="delete-report-reason"
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            aria-describedby="delete-report-reason-hint"
          />
        </Field>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !valid}
          >
            {mutation.isPending ? "Deleting..." : "Delete report"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
