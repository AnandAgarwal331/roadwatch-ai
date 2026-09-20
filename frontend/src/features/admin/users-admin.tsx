"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, UserCog } from "lucide-react";
import * as React from "react";

import { PageHeading } from "@/components/dashboard/dashboard-shell";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api";
import type { RepairTeamWithLoad, User, UserRole } from "@/types";

const ROLE_LABELS: Record<UserRole, string> = {
  CITIZEN: "Citizen",
  REPAIR_TEAM: "Repair crew",
  ADMIN: "Administrator",
};

const NO_TEAM = "NONE";
const ANY = "ANY";

export function UsersAdmin() {
  const [search, setSearch] = React.useState("");
  const [roleFilter, setRoleFilter] = React.useState(ANY);
  const [editing, setEditing] = React.useState<User | null>(null);

  const users = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => api.get<User[]>("/admin/users", { limit: 200 }),
  });
  const teams = useQuery({
    queryKey: ["admin", "teams"],
    queryFn: () => api.get<RepairTeamWithLoad[]>("/admin/teams"),
  });
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.get<User>("/auth/me") });

  const teamName = React.useMemo(
    () => new Map((teams.data ?? []).map((team) => [team.id, team.name])),
    [teams.data],
  );

  const visible = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (users.data ?? []).filter(
      (user) =>
        (roleFilter === ANY || user.role === roleFilter) &&
        (!needle ||
          user.email.toLowerCase().includes(needle) ||
          user.full_name.toLowerCase().includes(needle)),
    );
  }, [users.data, search, roleFilter]);

  return (
    <>
      <PageHeading
        title="Users"
        description="Who can do what. Make someone an administrator, or put them on a repair crew."
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[16rem] flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            aria-label="Search by name or email"
            placeholder="Search by name or email"
            className="pl-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-[12rem]" aria-label="Filter by role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All roles</SelectItem>
            {(Object.keys(ROLE_LABELS) as UserRole[]).map((role) => (
              <SelectItem key={role} value={role}>
                {ROLE_LABELS[role]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {users.isPending ? (
        <TableSkeleton rows={6} columns={4} />
      ) : users.isError ? (
        <ErrorState
          title="Could not load users"
          description={errorMessage(users.error)}
          onRetry={() => users.refetch()}
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={UserCog}
          title="No matching users"
          description="Try a different search or role filter."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Crew</th>
                <th className="px-4 py-3 text-right font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visible.map((user) => (
                <tr key={user.id} className="transition-colors hover:bg-muted/40">
                  <td className="px-4 py-3">
                    <p className="font-medium">
                      {user.full_name || "Unnamed"}
                      {user.id === me.data?.id ? (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">(you)</span>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">{user.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={user.role === "ADMIN" ? "default" : "outline"}>
                      {ROLE_LABELS[user.role]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {user.team_id ? (teamName.get(user.team_id) ?? "Unknown crew") : "-"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="outline" size="sm" onClick={() => setEditing(user)}>
                      Edit
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <EditUserDialog
        key={editing?.id ?? "none"}
        user={editing}
        isSelf={editing?.id === me.data?.id}
        teams={teams.data ?? []}
        onClose={() => setEditing(null)}
      />
    </>
  );
}

function EditUserDialog({
  user,
  isSelf,
  teams,
  onClose,
}: {
  user: User | null;
  isSelf: boolean;
  teams: RepairTeamWithLoad[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { success, error: toastError } = useToast();
  const [role, setRole] = React.useState<UserRole>(user?.role ?? "CITIZEN");
  const [teamId, setTeamId] = React.useState<string>(user?.team_id ?? NO_TEAM);

  const needsTeam = role === "REPAIR_TEAM";
  const teamAllowed = role !== "CITIZEN";
  const missingTeam = needsTeam && teamId === NO_TEAM;

  const mutation = useMutation({
    mutationFn: () =>
      api.patch<User>(`/admin/users/${user!.id}`, {
        role,
        team_id: teamAllowed && teamId !== NO_TEAM ? teamId : null,
      }),
    onSuccess: () => {
      success("Account updated", `${user!.email} is now ${ROLE_LABELS[role].toLowerCase()}.`);
      void queryClient.invalidateQueries({ queryKey: ["admin"] });
      onClose();
    },
    onError: (error: unknown) => toastError("Could not update this account", errorMessage(error)),
  });

  return (
    <Dialog open={user !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {user?.full_name || user?.email}</DialogTitle>
          <DialogDescription>
            {user?.email}. The change is written to the audit trail and takes effect the next time
            they sign in.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field
            id="user-role"
            label="Role"
            hint={isSelf ? "You cannot change your own role - ask another administrator." : undefined}
          >
            <Select value={role} onValueChange={(value) => setRole(value as UserRole)} disabled={isSelf}>
              <SelectTrigger id="user-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(ROLE_LABELS) as UserRole[]).map((item) => (
                  <SelectItem key={item} value={item}>
                    {ROLE_LABELS[item]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field
            id="user-team"
            label="Repair crew"
            required={needsTeam}
            hint={
              !teamAllowed
                ? "Citizens are not on a crew."
                : needsTeam
                  ? "Required for crew members."
                  : "Optional. Lets an administrator use the crew console for this crew."
            }
            error={missingTeam ? "Choose a crew for this member." : undefined}
          >
            <Select value={teamId} onValueChange={setTeamId} disabled={!teamAllowed}>
              <SelectTrigger id="user-team">
                <SelectValue placeholder="No crew" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_TEAM}>No crew</SelectItem>
                {teams
                  .filter((team) => team.is_active)
                  .map((team) => (
                    <SelectItem key={team.id} value={team.id}>
                      {team.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || missingTeam}>
            {mutation.isPending ? "Saving..." : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
