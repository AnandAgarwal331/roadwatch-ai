"use client";

import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import { PageHeading } from "@/components/dashboard/dashboard-shell";
import { ErrorState, TableSkeleton } from "@/components/shared/states";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { api, errorMessage } from "@/lib/api";
import { PRIORITY_DISCLAIMER } from "@/lib/constants";
import { formatDistance, formatPercent, humanise } from "@/lib/utils";
import type { SystemSettings } from "@/types";

/** What each weight actually measures, in the words the score explanation uses. */
const WEIGHT_DESCRIPTIONS: Record<string, string> = {
  severity: "How bad the damage looks in the photograph, estimated by the vision model.",
  traffic: "How busy the road is at the reported location.",
  location: "Whether the spot sits near a hospital, school, bus stop or major junction.",
  history: "Whether this location has been reported before and keeps coming back.",
};

export function SettingsView() {
  const query = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: () => api.get<SystemSettings>("/admin/settings"),
  });

  if (query.isPending) {
    return (
      <>
        <PageHeading title="Scoring settings" />
        <TableSkeleton rows={6} columns={3} />
      </>
    );
  }

  if (query.isError) {
    return (
      <>
        <PageHeading title="Scoring settings" />
        <ErrorState
          title="Could not load the settings"
          description={errorMessage(query.error)}
          onRetry={() => query.refetch()}
        />
      </>
    );
  }

  const settings = query.data;
  const weights = Object.entries(settings.priority_weights);
  const weightTotal = weights.reduce((sum, [, value]) => sum + value, 0);

  return (
    <>
      <PageHeading
        title="Scoring settings"
        description={`The configuration the scoring engine is running with right now, version ${settings.engine_version}.`}
      />

      <Alert variant="info" title="Read-only" className="mb-6">
        These values come from the service configuration, not from a database, so they are shown
        here rather than edited here. Changing them is a deployment change, which keeps a scoring
        rule from being altered silently mid-operation.
      </Alert>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Priority weights</CardTitle>
            <CardDescription>
              How much each factor contributes to the final 0-100 score. Every factor is scored 0-10
              and multiplied by its weight, so these add up to the whole of the score.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {weights.map(([key, value]) => (
              <div key={key}>
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">{humanise(key)}</span>
                  <span className="text-sm tabular-nums text-muted-foreground">
                    {weightTotal > 0 ? formatPercent(value / weightTotal) : "-"}
                  </span>
                </div>
                <Progress
                  value={value}
                  max={weightTotal || 1}
                  label={`${humanise(key)} weight`}
                />
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {WEIGHT_DESCRIPTIONS[key] ?? "Contributes to the priority score."}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Priority bands</CardTitle>
            <CardDescription>
              The score at which a report moves up a band. Anything below the medium threshold is
              low.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-3">
              {Object.entries(settings.priority_thresholds).map(([level, value]) => (
                <div key={level} className="rounded-lg border border-border p-3">
                  <dt className="text-xs text-muted-foreground">{humanise(level)} at or above</dt>
                  <dd className="mt-1 text-xl font-semibold tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Distances and windows</CardTitle>
            <CardDescription>
              The radii the engine searches when it looks for context around a report.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Row
                label="Nearby places radius"
                value={formatDistance(settings.nearby_radius_meters)}
                hint="How far out it looks for hospitals, schools and junctions."
              />
              <Row
                label="Duplicate radius"
                value={formatDistance(settings.duplicate_radius_meters)}
                hint="Two reports closer than this may be the same problem."
              />
              <Row
                label="Duplicate window"
                value={`${settings.duplicate_window_days} days`}
                hint="Reports further apart in time are not treated as duplicates."
              />
              <Row
                label="History radius"
                value={formatDistance(settings.history_radius_meters)}
                hint="How far out it looks for previous reports at the same spot."
              />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Providers</CardTitle>
            <CardDescription>
              Which implementation each pluggable service is currently running.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Provider label="Vision model" value={settings.ai_provider} />
              <Provider label="Traffic" value={settings.traffic_provider} />
              <Provider label="Places" value={settings.places_provider} />
              <Provider label="Storage" value={settings.storage_provider} />
              <Provider
                label="Weather"
                value={settings.weather_enabled ? "Enabled" : "Disabled"}
              />
              <Row
                label="Minimum AI confidence"
                value={formatPercent(settings.ai_min_confidence)}
                hint="Below this, a report is flagged for manual review."
              />
              <Row label="Maximum upload size" value={`${settings.max_upload_mb} MB`} />
            </dl>
          </CardContent>
        </Card>
      </div>

      <p className="mt-6 text-xs text-muted-foreground">{PRIORITY_DISCLAIMER}</p>
    </>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{value}</dd>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Provider({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1">
        <Badge variant="muted">{humanise(value)}</Badge>
      </dd>
    </div>
  );
}
