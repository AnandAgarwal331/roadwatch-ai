import {
  Bus,
  Building2,
  Construction,
  Croissant,
  Footprints,
  GitFork,
  HelpCircle,
  Hospital,
  Lightbulb,
  School,
  ShieldAlert,
  Waves,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import {
  DAMAGE_TYPE_LABELS,
  PLACE_TYPE_LABELS,
  PRIORITY_LABELS,
  PRIORITY_STYLES,
  STATUS_LABELS,
  STATUS_STYLES,
  TRAFFIC_LABELS,
} from "@/lib/constants";
import { cn } from "@/lib/utils";
import type {
  ComplaintStatus,
  DamageType,
  PlaceType,
  PriorityLevel,
  TrafficLevel,
} from "@/types";

export const DAMAGE_ICONS: Record<DamageType, LucideIcon> = {
  POTHOLE: Construction,
  CRACKED_ROAD: GitFork,
  FLOODING: Waves,
  DAMAGED_SIDEWALK: Footprints,
  BROKEN_STREETLIGHT: Lightbulb,
  OTHER: Croissant,
  UNKNOWN: HelpCircle,
};

export const PLACE_ICONS: Record<PlaceType, LucideIcon> = {
  HOSPITAL: Hospital,
  SCHOOL: School,
  BUS_STOP: Bus,
  MAJOR_INTERSECTION: GitFork,
  EMERGENCY_SERVICE: ShieldAlert,
};

export function StatusBadge({
  status,
  className,
}: {
  status: ComplaintStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        STATUS_STYLES[status],
        className,
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

export function PriorityBadge({
  level,
  score,
  className,
}: {
  level: PriorityLevel;
  score?: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        PRIORITY_STYLES[level],
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {PRIORITY_LABELS[level]}
      {score !== undefined ? <span className="tabular-nums font-medium">{score.toFixed(0)}</span> : null}
    </span>
  );
}

export function DamageTypeBadge({
  type,
  className,
  showIcon = true,
}: {
  type: DamageType;
  className?: string;
  showIcon?: boolean;
}) {
  const Icon = DAMAGE_ICONS[type];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2.5 py-0.5 text-xs font-medium text-foreground",
        className,
      )}
    >
      {showIcon ? <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /> : null}
      {DAMAGE_TYPE_LABELS[type]}
    </span>
  );
}

export function TrafficBadge({ level, className }: { level: TrafficLevel; className?: string }) {
  const tone =
    level === "VERY_HIGH" || level === "HIGH"
      ? "text-priority-high border-priority-high/30 bg-priority-high/10"
      : level === "MEDIUM"
        ? "text-priority-medium border-priority-medium/30 bg-priority-medium/10"
        : "text-priority-low border-priority-low/30 bg-priority-low/10";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        tone,
        className,
      )}
    >
      {TRAFFIC_LABELS[level]} traffic
    </span>
  );
}

export function PlaceTypeIcon({ type, className }: { type: PlaceType; className?: string }) {
  const Icon = PLACE_ICONS[type] ?? Building2;
  return <Icon className={cn("h-4 w-4", className)} aria-label={PLACE_TYPE_LABELS[type]} />;
}
