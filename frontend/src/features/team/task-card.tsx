import { AlertTriangle, Clock, MapPin, RotateCcw, Siren } from "lucide-react";
import Link from "next/link";

import { DamageTypeBadge, PriorityBadge } from "@/components/complaints/badges";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ASSIGNMENT_STATUS_LABELS, ASSIGNMENT_STATUS_STYLES } from "@/lib/constants";
import { cn, formatDateTime, timeAgo } from "@/lib/utils";
import type { Task } from "@/types";

/** Assignment state as a chip; the label always rides along with the colour. */
export function AssignmentStatusBadge({ task }: { task: Task }) {
  return (
    <Badge variant="outline" className={cn(ASSIGNMENT_STATUS_STYLES[task.status])}>
      {ASSIGNMENT_STATUS_LABELS[task.status]}
    </Badge>
  );
}

/**
 * One job in a list.
 *
 * A crew reads this on a phone at the roadside, so the three things that decide
 * what to do next - how urgent, where, and by when - come before anything else.
 */
export function TaskCard({ task, className }: { task: Task; className?: string }) {
  const { complaint } = task;

  return (
    <Card className={cn("transition-shadow hover:shadow-card-hover", className)}>
      <Link href={`/team/tasks/${task.id}`} className="block p-4 focus:outline-none">
        <div className="flex flex-wrap items-center gap-2">
          <PriorityBadge level={complaint.priority_level} score={complaint.priority_score} />
          <DamageTypeBadge type={complaint.damage_type} />
          <AssignmentStatusBadge task={task} />
          {task.is_emergency ? (
            <Badge variant="destructive">
              <Siren className="h-3 w-3" aria-hidden="true" />
              Emergency
            </Badge>
          ) : null}
          {task.status === "IN_PROGRESS" && task.rework_count > 0 ? (
            <Badge variant="outline" className="border-warning/30 bg-warning/10 text-warning">
              <RotateCcw className="h-3 w-3" aria-hidden="true" />
              Rework
            </Badge>
          ) : null}
          {task.is_overdue ? (
            <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              Overdue
            </Badge>
          ) : null}
        </div>

        <p className="mt-3 line-clamp-2 text-sm text-foreground">
          {complaint.description ?? "No description was provided for this report."}
        </p>

        <div className="mt-3 space-y-1.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{complaint.road_name ?? "Location on map"}</span>
          </span>

          <span className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {task.due_at ? (
              <span className={cn(task.is_overdue && "font-medium text-destructive")}>
                Due {formatDateTime(task.due_at)}
              </span>
            ) : (
              <span>No due date set</span>
            )}
          </span>
        </div>

        <p className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="font-mono text-[11px]">{complaint.complaint_number}</span>
          <span>Assigned {timeAgo(task.created_at)}</span>
        </p>
      </Link>
    </Card>
  );
}
