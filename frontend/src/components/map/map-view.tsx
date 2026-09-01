"use client";

import dynamic from "next/dynamic";
import { MapPinned } from "lucide-react";

import type { IssueMapProps } from "@/components/map/issue-map";
import type { LocationPickerProps } from "@/components/map/location-picker";
import { cn } from "@/lib/utils";

/**
 * Client-only wrappers for the Leaflet maps.
 *
 * Leaflet touches `window` at import time, so both maps are loaded with
 * `ssr: false` and given an explicit loading state - a blank rectangle where a
 * map should be reads as breakage.
 */

function MapLoading({ label }: { label: string }) {
  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-3 bg-muted"
      aria-busy="true"
      aria-live="polite"
    >
      <MapPinned className="h-7 w-7 animate-pulse text-muted-foreground" aria-hidden="true" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

const IssueMapDynamic = dynamic(() => import("@/components/map/issue-map"), {
  ssr: false,
  loading: () => <MapLoading label="Loading map..." />,
});

const LocationPickerDynamic = dynamic(() => import("@/components/map/location-picker"), {
  ssr: false,
  loading: () => <MapLoading label="Loading map..." />,
});

export function IssueMapView({ className, ...props }: IssueMapProps & { className?: string }) {
  return (
    <div className={cn("relative h-full w-full overflow-hidden", className)}>
      <IssueMapDynamic {...props} />
    </div>
  );
}

export function LocationPickerView({
  className,
  ...props
}: LocationPickerProps & { className?: string }) {
  return (
    <div className={cn("relative h-full w-full overflow-hidden", className)}>
      <LocationPickerDynamic {...props} />
    </div>
  );
}
