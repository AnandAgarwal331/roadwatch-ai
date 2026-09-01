import { Car, MapPin, Navigation } from "lucide-react";

import { PlaceTypeIcon, TrafficBadge } from "@/components/complaints/badges";
import { PLACE_TYPE_LABELS } from "@/lib/constants";
import { formatCoordinate, formatDistance } from "@/lib/utils";
import type { ComplaintDetail } from "@/types";

/**
 * The context that fed the score: where it is, how busy the road is, and what
 * sits nearby. Shown alongside the breakdown so the factors are checkable
 * against the underlying evidence.
 */
export function ContextPanel({ complaint }: { complaint: ComplaintDetail }) {
  const places = complaint.nearby_places.slice(0, 6);

  return (
    <div className="space-y-5">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <MapPin className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Location
        </h3>
        <dl className="mt-2 space-y-1.5 text-sm">
          {complaint.location?.address ? (
            <div>
              <dt className="sr-only">Address</dt>
              <dd className="text-muted-foreground">{complaint.location.address}</dd>
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">Coordinates</dt>
            <dd className="font-mono text-xs tabular-nums">
              {formatCoordinate(complaint.latitude)}, {formatCoordinate(complaint.longitude)}
            </dd>
          </div>
          {complaint.road_name ? (
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">Road</dt>
              <dd className="text-right">{complaint.road_name}</dd>
            </div>
          ) : null}
          {complaint.location?.accuracy_meters ? (
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">GPS accuracy</dt>
              <dd>{formatDistance(complaint.location.accuracy_meters)}</dd>
            </div>
          ) : null}
        </dl>
      </div>

      {complaint.traffic ? (
        <div>
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <Car className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Traffic
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <TrafficBadge level={complaint.traffic.level} />
            <span className="text-sm text-muted-foreground">
              {complaint.traffic.score.toFixed(1)}/10
            </span>
            {complaint.traffic.estimated_vehicles_per_hour ? (
              <span className="text-sm text-muted-foreground">
                &middot; ~{complaint.traffic.estimated_vehicles_per_hour.toLocaleString()} vehicles/hour
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <div>
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <Navigation className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Nearby facilities
        </h3>

        {places.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            No hospitals, schools, bus stops or emergency services within 500m.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {places.map((place, index) => (
              <li key={`${place.name}-${index}`} className="flex items-center gap-2.5 text-sm">
                <PlaceTypeIcon type={place.place_type} className="shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{place.name}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatDistance(place.distance_meters)}
                </span>
              </li>
            ))}
          </ul>
        )}

        {complaint.nearby_places.length > places.length ? (
          <p className="mt-2 text-xs text-muted-foreground">
            and {complaint.nearby_places.length - places.length} more within 500m
          </p>
        ) : null}
      </div>

      {complaint.report_count > 1 ? (
        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <p className="text-sm">
            <span className="font-medium">{complaint.report_count} reports</span> have been linked to
            this issue.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Repeat reports at the same location raise the complaint-history factor.
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function PLACE_LABEL(type: keyof typeof PLACE_TYPE_LABELS): string {
  return PLACE_TYPE_LABELS[type];
}
