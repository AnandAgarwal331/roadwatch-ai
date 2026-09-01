import { Layers, MapPin } from "lucide-react";
import Link from "next/link";

import { DamageTypeBadge, PriorityBadge, StatusBadge } from "@/components/complaints/badges";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DAMAGE_TYPE_LABELS } from "@/lib/constants";
import { cn, timeAgo } from "@/lib/utils";
import type { ComplaintSummary } from "@/types";

interface ComplaintCardProps {
  complaint: ComplaintSummary;
  href?: string;
  className?: string;
}

export function ComplaintCard({ complaint, href, className }: ComplaintCardProps) {
  const target = href ?? `/reports/${complaint.id}`;

  return (
    <Card
      className={cn(
        "group overflow-hidden transition-shadow duration-200 hover:shadow-card-hover focus-within:shadow-card-hover",
        className,
      )}
    >
      <Link href={target} className="block focus:outline-none">
        <div className="relative aspect-[16/10] overflow-hidden bg-muted">
          {complaint.thumbnail_url ? (
            // Uploaded photos are user content of unknown dimensions; a plain
            // img keeps the aspect handling simple and avoids a loader round-trip.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={complaint.thumbnail_url}
              alt={`${DAMAGE_TYPE_LABELS[complaint.damage_type]} reported at ${
                complaint.road_name ?? "an unnamed road"
              }`}
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No photo provided
            </div>
          )}

          <div className="absolute left-3 top-3">
            <PriorityBadge
              level={complaint.priority_level}
              score={complaint.priority_score}
              className="bg-card/95 backdrop-blur-sm"
            />
          </div>

          {complaint.report_count > 1 ? (
            <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-card/95 px-2.5 py-0.5 text-xs font-medium backdrop-blur-sm">
              <Layers className="h-3 w-3" aria-hidden="true" />
              {complaint.report_count} reports
            </span>
          ) : null}
        </div>

        <div className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <DamageTypeBadge type={complaint.damage_type} />
            <StatusBadge status={complaint.status} />
          </div>

          <p className="line-clamp-2 text-sm leading-relaxed text-foreground">
            {complaint.description ?? "No description was provided for this report."}
          </p>

          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span className="flex min-w-0 items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{complaint.road_name ?? "Location on map"}</span>
            </span>
            <span className="shrink-0 font-mono text-[11px]">{complaint.complaint_number}</span>
          </div>

          <p className="text-xs text-muted-foreground">Reported {timeAgo(complaint.created_at)}</p>
        </div>
      </Link>
    </Card>
  );
}

export function ComplaintCardSkeleton() {
  return (
    <Card className="overflow-hidden">
      <Skeleton className="aspect-[16/10] rounded-none" />
      <div className="space-y-3 p-4">
        <div className="flex gap-2">
          <Skeleton className="h-5 w-24 rounded-full" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </Card>
  );
}
