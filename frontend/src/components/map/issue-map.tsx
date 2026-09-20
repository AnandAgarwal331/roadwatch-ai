"use client";

import "leaflet/dist/leaflet.css";

import L from "leaflet";
import "leaflet.heat";
import { useEffect, useMemo } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";

import { DamageTypeBadge, PriorityBadge, StatusBadge } from "@/components/complaints/badges";
import { Button } from "@/components/ui/button";
import { DAMAGE_TYPE_LABELS, DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM, PRIORITY_HEX } from "@/lib/constants";
import { timeAgo } from "@/lib/utils";
import type { MapIssue, PriorityLevel } from "@/types";

/**
 * Markers are `divIcon`s rather than image pins.
 *
 * That avoids Leaflet's well-known broken default-icon paths under a bundler,
 * needs no image assets, and lets a marker carry its priority colour directly -
 * so the map reads as a heat map at a glance.
 */
function priorityIcon(level: PriorityLevel, reportCount: number): L.DivIcon {
  const colour = PRIORITY_HEX[level];
  const size = level === "CRITICAL" ? 30 : level === "HIGH" ? 26 : 22;
  const pulse =
    level === "CRITICAL"
      ? `<span style="position:absolute;inset:-6px;border-radius:9999px;background:${colour};opacity:.22;"></span>`
      : "";
  const badge =
    reportCount > 1
      ? `<span style="position:absolute;top:-6px;right:-8px;min-width:16px;height:16px;padding:0 3px;border-radius:9999px;background:#0f172a;color:#fff;font-size:10px;line-height:16px;text-align:center;font-weight:600;border:1.5px solid #fff;">${
          reportCount > 99 ? "99+" : reportCount
        }</span>`
      : "";

  return L.divIcon({
    className: "roadwatch-marker",
    html: `<span style="position:relative;display:block;width:${size}px;height:${size}px;">
      ${pulse}
      <span style="position:absolute;inset:0;border-radius:9999px;background:${colour};border:2.5px solid #fff;box-shadow:0 2px 6px rgba(15,23,42,.35);"></span>
      ${badge}
    </span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

/** Refits the viewport when the marker set changes. */
function FitBounds({ issues, enabled }: { issues: MapIssue[]; enabled: boolean }) {
  const map = useMap();

  useEffect(() => {
    if (!enabled || issues.length === 0) return;

    const bounds = L.latLngBounds(issues.map((issue) => [issue.latitude, issue.longitude]));
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [48, 48], maxZoom: 15 });
    }
  }, [map, issues, enabled]);

  return null;
}

/**
 * Density of *reported problems*, not literal geographic risk - intensity is
 * weighted by priority score so a cluster of critical reports glows hotter
 * than the same number of low-priority ones, and the gradient reuses the
 * same LOW-to-CRITICAL hues as every marker/badge/chart elsewhere, so this
 * reads as the same severity language rather than an unrelated heat palette.
 */
function HeatmapLayer({ issues }: { issues: MapIssue[] }) {
  const map = useMap();

  useEffect(() => {
    const points: L.HeatLatLngTuple[] = issues.map((issue) => [
      issue.latitude,
      issue.longitude,
      0.35 + (issue.priority_score / 100) * 0.65, // a floor so low-priority reports still register
    ]);
    if (points.length === 0) return;

    const layer = L.heatLayer(points, {
      radius: 26,
      blur: 20,
      maxZoom: 16,
      gradient: {
        0.0: PRIORITY_HEX.LOW,
        0.45: PRIORITY_HEX.MEDIUM,
        0.75: PRIORITY_HEX.HIGH,
        1.0: PRIORITY_HEX.CRITICAL,
      },
    }).addTo(map);

    return () => {
      map.removeLayer(layer);
    };
  }, [map, issues]);

  return null;
}

/** Leaflet mis-measures when its container starts hidden or resizes. */
function InvalidateOnMount() {
  const map = useMap();

  useEffect(() => {
    const timer = window.setTimeout(() => map.invalidateSize(), 120);
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());

    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [map]);

  return null;
}

export interface IssueMapProps {
  issues: MapIssue[];
  center?: [number, number];
  zoom?: number;
  className?: string;
  fitToIssues?: boolean;
  /** Where a popup's "View complaint" link should point. */
  detailBasePath?: string;
  onSelect?: (issue: MapIssue) => void;
  /** "markers" (default) for individual pins, "heat" for a density layer. */
  mode?: "markers" | "heat";
}

export default function IssueMap({
  issues,
  center = DEFAULT_MAP_CENTER,
  zoom = DEFAULT_MAP_ZOOM,
  className,
  fitToIssues = true,
  detailBasePath = "/reports",
  onSelect,
  mode = "markers",
}: IssueMapProps) {
  const markers = useMemo(
    () =>
      issues.filter(
        (issue) => Number.isFinite(issue.latitude) && Number.isFinite(issue.longitude),
      ),
    [issues],
  );

  return (
    <MapContainer
      center={center}
      zoom={zoom}
      scrollWheelZoom
      className={className}
      style={{ height: "100%", width: "100%" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />
      <InvalidateOnMount />
      <FitBounds issues={markers} enabled={fitToIssues} />
      {mode === "heat" ? <HeatmapLayer issues={markers} /> : null}

      {mode === "markers" && markers.map((issue) => (
        <Marker
          key={issue.id}
          position={[issue.latitude, issue.longitude]}
          icon={priorityIcon(issue.priority_level, issue.report_count)}
          eventHandlers={onSelect ? { click: () => onSelect(issue) } : undefined}
          alt={`${DAMAGE_TYPE_LABELS[issue.damage_type]} at ${issue.road_name ?? "unnamed road"}`}
        >
          <Popup>
            <div className="w-64 space-y-3 p-3">
              <div className="flex items-start justify-between gap-2">
                <span className="font-mono text-[11px] text-muted-foreground">
                  {issue.complaint_number}
                </span>
                <PriorityBadge level={issue.priority_level} score={issue.priority_score} />
              </div>

              <p className="text-sm font-medium leading-snug">
                {DAMAGE_TYPE_LABELS[issue.damage_type]}
                {issue.road_name ? (
                  <span className="font-normal text-muted-foreground"> &middot; {issue.road_name}</span>
                ) : null}
              </p>

              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                <dt className="text-muted-foreground">Severity</dt>
                <dd className="text-right font-medium tabular-nums">
                  {issue.severity_score.toFixed(1)}/10
                </dd>
                <dt className="text-muted-foreground">Reports</dt>
                <dd className="text-right font-medium tabular-nums">{issue.report_count}</dd>
                <dt className="text-muted-foreground">Reported</dt>
                <dd className="text-right font-medium">{timeAgo(issue.created_at)}</dd>
              </dl>

              <div className="flex flex-wrap gap-1.5">
                <DamageTypeBadge type={issue.damage_type} showIcon={false} />
                <StatusBadge status={issue.status} />
              </div>

              <Button asChild size="sm" className="w-full">
                <a href={`${detailBasePath}/${issue.id}`}>View complaint</a>
              </Button>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
