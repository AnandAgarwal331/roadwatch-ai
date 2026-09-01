"use client";

import { Crosshair, MapPin } from "lucide-react";
import * as React from "react";

import { LocationPickerView } from "@/components/map/map-view";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { formatCoordinate } from "@/lib/utils";

export interface LocationValue {
  latitude: number;
  longitude: number;
  accuracyMeters?: number | null;
  address?: string;
}

interface LocationStepProps {
  value: LocationValue | null;
  onChange: (value: LocationValue | null) => void;
}

type GeoState = "idle" | "locating" | "denied" | "unavailable" | "done";

export function LocationStep({ value, onChange }: LocationStepProps) {
  const [geoState, setGeoState] = React.useState<GeoState>("idle");

  function useMyLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoState("unavailable");
      return;
    }

    setGeoState("locating");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        onChange({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
          address: value?.address,
        });
        setGeoState("done");
      },
      (error) => {
        // A refusal is a choice, not a failure - the map still works.
        setGeoState(error.code === error.PERMISSION_DENIED ? "denied" : "unavailable");
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 },
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium">Where is the problem?</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Use your current location, or tap the map to place the pin exactly.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={useMyLocation}
          loading={geoState === "locating"}
        >
          <Crosshair aria-hidden="true" />
          Use My Current Location
        </Button>
      </div>

      {geoState === "denied" ? (
        <Alert variant="warning" title="Location access was blocked">
          <p>
            No problem - tap the map below to place the pin, or enable location for this site in
            your browser settings and try again.
          </p>
        </Alert>
      ) : null}

      {geoState === "unavailable" ? (
        <Alert variant="warning" title="Could not get your location">
          <p>Your device did not return a position. Tap the map below to place the pin instead.</p>
        </Alert>
      ) : null}

      <div className="h-[340px] overflow-hidden rounded-xl border border-border sm:h-[400px]">
        <LocationPickerView
          value={value ? { latitude: value.latitude, longitude: value.longitude } : null}
          onChange={(coords) =>
            onChange({
              ...coords,
              accuracyMeters: value?.accuracyMeters ?? null,
              address: value?.address,
            })
          }
        />
      </div>

      {value ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <p className="text-xs text-muted-foreground">Latitude</p>
            <p className="mt-0.5 font-mono text-sm tabular-nums">
              {formatCoordinate(value.latitude)}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <p className="text-xs text-muted-foreground">Longitude</p>
            <p className="mt-0.5 font-mono text-sm tabular-nums">
              {formatCoordinate(value.longitude)}
            </p>
          </div>
          {value.accuracyMeters ? (
            <p className="text-xs text-muted-foreground sm:col-span-2">
              Accurate to about {Math.round(value.accuracyMeters)}m. Drag the pin if it is not
              exactly right.
            </p>
          ) : null}
        </div>
      ) : (
        <Alert variant="info" icon={false}>
          <p className="flex items-center gap-2">
            <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
            No location selected yet. Tap the map or use your current location.
          </p>
        </Alert>
      )}

      <Field
        id="address"
        label="Nearest landmark or address"
        hint="Optional, but it helps the repair crew find the exact spot."
      >
        <Input
          id="address"
          value={value?.address ?? ""}
          disabled={!value}
          placeholder="e.g. Opposite Manipal Hospital, Old Airport Road"
          aria-describedby="address-hint"
          onChange={(event) =>
            value ? onChange({ ...value, address: event.target.value }) : undefined
          }
        />
      </Field>
    </div>
  );
}
