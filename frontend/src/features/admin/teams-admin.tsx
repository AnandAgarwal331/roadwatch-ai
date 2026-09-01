"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Users } from "lucide-react";
import * as React from "react";

import { PageHeading } from "@/components/dashboard/dashboard-shell";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/shared/states";
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
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/components/ui/toast";
import { ApiError, api, errorMessage } from "@/lib/api";
import type { RepairTeam, RepairTeamWithLoad } from "@/types";

export function TeamsAdmin() {
  const [editing, setEditing] = React.useState<RepairTeamWithLoad | null>(null);
  const [creating, setCreating] = React.useState(false);

  const query = useQuery({
    queryKey: ["admin", "teams"],
    queryFn: () => api.get<RepairTeamWithLoad[]>("/admin/teams"),
  });

  return (
    <>
      <PageHeading
        title="Repair teams"
        description="The crews work is assigned to, their zones and how loaded they currently are."
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" />
            Add a crew
          </Button>
        }
      />

      {query.isPending ? (
        <TableSkeleton rows={4} columns={4} />
      ) : query.isError ? (
        <ErrorState
          title="Could not load the crews"
          description={errorMessage(query.error)}
          onRetry={() => query.refetch()}
        />
      ) : query.data.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No repair crews yet"
          description="Add a crew before assigning any repairs."
          action={
            <Button size="sm" onClick={() => setCreating(true)}>
              Add a crew
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {query.data.map((team) => (
            <TeamCard key={team.id} team={team} onEdit={() => setEditing(team)} />
          ))}
        </div>
      )}

      <TeamDialog
        key={editing?.id ?? "new"}
        team={editing}
        open={creating || editing !== null}
        onOpenChange={(value) => {
          if (!value) {
            setCreating(false);
            setEditing(null);
          }
        }}
      />
    </>
  );
}

function TeamCard({ team, onEdit }: { team: RepairTeamWithLoad; onEdit: () => void }) {
  // Load is a ratio against a limit, so it is a meter rather than a chart.
  const load = team.max_concurrent_jobs > 0 ? team.open_jobs / team.max_concurrent_jobs : 0;
  const atCapacity = team.open_jobs >= team.max_concurrent_jobs;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="truncate">{team.name}</CardTitle>
            <p className="mt-0.5 font-mono text-xs text-muted-foreground">{team.code}</p>
          </div>
          {team.is_active ? (
            <Badge variant="success">Active</Badge>
          ) : (
            <Badge variant="muted">Inactive</Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Current load</span>
            <span className={atCapacity ? "font-medium text-warning" : "text-muted-foreground"}>
              {team.open_jobs} of {team.max_concurrent_jobs}
            </span>
          </div>
          <Progress
            value={team.open_jobs}
            max={team.max_concurrent_jobs}
            label={`${team.name} workload`}
            indicatorClassName={
              atCapacity ? "bg-warning" : load > 0.66 ? "bg-priority-medium" : undefined
            }
          />
        </div>

        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Zone</dt>
            <dd className="mt-0.5 truncate">{team.zone ?? "Not set"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Completed</dt>
            <dd className="mt-0.5 tabular-nums">{team.completed_jobs}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-xs text-muted-foreground">Specialities</dt>
            <dd className="mt-0.5">{team.specialities ?? "General road repair"}</dd>
          </div>
          {team.contact_phone ? (
            <div className="col-span-2">
              <dt className="text-xs text-muted-foreground">Contact</dt>
              <dd className="mt-0.5">{team.contact_phone}</dd>
            </div>
          ) : null}
        </dl>

        <div>
          <p className="mb-1 text-xs text-muted-foreground">
            Members ({team.members.length})
          </p>
          {team.members.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No accounts are linked to this crew yet.
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {team.members.map((member) => (
                <li key={member.id} className="truncate">
                  {member.full_name}
                </li>
              ))}
            </ul>
          )}
        </div>

        <Button variant="outline" size="sm" className="w-full" onClick={onEdit}>
          Edit crew
        </Button>
      </CardContent>
    </Card>
  );
}

/** Create when `team` is null, otherwise edit that crew. */
function TeamDialog({
  team,
  open,
  onOpenChange,
}: {
  team: RepairTeamWithLoad | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { success, error: toastError } = useToast();

  const [name, setName] = React.useState(team?.name ?? "");
  const [code, setCode] = React.useState(team?.code ?? "");
  const [zone, setZone] = React.useState(team?.zone ?? "");
  const [phone, setPhone] = React.useState(team?.contact_phone ?? "");
  const [specialities, setSpecialities] = React.useState(team?.specialities ?? "");
  const [capacity, setCapacity] = React.useState(String(team?.max_concurrent_jobs ?? 5));
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        zone: zone.trim() || null,
        contact_phone: phone.trim() || null,
        specialities: specialities.trim() || null,
        max_concurrent_jobs: Number(capacity),
      };

      // The code identifies the crew and is not editable after creation.
      return team
        ? api.patch<RepairTeam>(`/admin/teams/${team.id}`, body)
        : api.post<RepairTeam>("/admin/teams", { ...body, code: code.trim().toUpperCase() });
    },
    onSuccess: () => {
      success(team ? "Crew updated" : "Crew created");
      void queryClient.invalidateQueries({ queryKey: ["admin", "teams"] });
      onOpenChange(false);
    },
    onError: (error) => {
      if (error instanceof ApiError && Object.keys(error.fieldErrors).length) {
        setFieldErrors(error.fieldErrors);
        setFormError(null);
        return;
      }
      setFormError(errorMessage(error));
      toastError(team ? "Could not update the crew" : "Could not create the crew", errorMessage(error));
    },
  });

  const capacityValue = Number(capacity);
  const capacityValid = Number.isInteger(capacityValue) && capacityValue >= 1 && capacityValue <= 100;
  const canSubmit =
    name.trim().length >= 2 && (team !== null || code.trim().length >= 2) && capacityValid;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{team ? `Edit ${team.name}` : "Add a repair crew"}</DialogTitle>
          <DialogDescription>
            Crews are what reports get assigned to. Capacity is how many open jobs a crew should
            hold at once; it is shown when assigning, but does not block an assignment.
          </DialogDescription>
        </DialogHeader>

        <form
          noValidate
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <Field id="team-name" label="Crew name" required error={fieldErrors.name}>
            <Input
              id="team-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </Field>

          {team ? null : (
            <Field
              id="team-code"
              label="Code"
              required
              hint="A short identifier, e.g. NORTH-1. Uppercased automatically and fixed once set."
              error={fieldErrors.code}
            >
              <Input
                id="team-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                aria-describedby="team-code-hint"
                required
              />
            </Field>
          )}

          <Field id="team-zone" label="Zone" error={fieldErrors.zone}>
            <Input id="team-zone" value={zone} onChange={(event) => setZone(event.target.value)} />
          </Field>

          <Field id="team-phone" label="Contact phone" error={fieldErrors.contact_phone}>
            <Input
              id="team-phone"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              inputMode="tel"
            />
          </Field>

          <Field
            id="team-specialities"
            label="Specialities"
            hint="Free text, e.g. resurfacing, drainage."
            error={fieldErrors.specialities}
          >
            <Input
              id="team-specialities"
              value={specialities}
              onChange={(event) => setSpecialities(event.target.value)}
              aria-describedby="team-specialities-hint"
            />
          </Field>

          <Field
            id="team-capacity"
            label="Concurrent job capacity"
            required
            error={
              !capacityValid && capacity !== ""
                ? "Enter a whole number between 1 and 100."
                : fieldErrors.max_concurrent_jobs
            }
          >
            <Input
              id="team-capacity"
              type="number"
              min={1}
              max={100}
              step={1}
              value={capacity}
              onChange={(event) => setCapacity(event.target.value)}
              required
            />
          </Field>

          {formError ? (
            <p role="alert" className="text-sm font-medium text-destructive">
              {formError}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit || mutation.isPending}>
              {mutation.isPending ? "Saving..." : team ? "Save changes" : "Create crew"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
