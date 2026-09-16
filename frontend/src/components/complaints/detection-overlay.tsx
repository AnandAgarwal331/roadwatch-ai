"use client";

import * as React from "react";

import { DAMAGE_TYPE_LABELS, PRIORITY_HEX } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { Detection } from "@/types";

interface DetectionOverlayProps {
  imageUrl: string;
  alt: string;
  detections: Detection[];
  className?: string;
  /** Start with boxes hidden (the citizen confirmation reveals them). */
  defaultVisible?: boolean;
  /** Original photo dimensions, when known, to reserve space before it loads. */
  width?: number | null;
  height?: number | null;
}

/**
 * The report photo with the detector's bounding boxes drawn over it.
 *
 * Boxes arrive normalised to 0-1, so they are positioned as percentages and
 * stay correct at any rendered size without measuring the image. The
 * container's aspect ratio is reserved up front (from `width`/`height` when
 * known, a 4:3 fallback otherwise) so a slow or failed image load never
 * collapses it to zero height - without that, every box's percentage `top`
 * resolves to nearly the same pixel and their labels pile up unreadably.
 */
export function DetectionOverlay({
  imageUrl,
  alt,
  detections,
  className,
  defaultVisible = true,
  width,
  height,
}: DetectionOverlayProps) {
  const [visible, setVisible] = React.useState(defaultVisible);
  const [failed, setFailed] = React.useState(false);
  const hasBoxes = detections.length > 0;
  const aspectRatio = width && height ? width / height : 4 / 3;

  return (
    <figure className={cn("space-y-3", className)}>
      <div
        className="relative overflow-hidden rounded-xl border border-border bg-muted"
        style={{ aspectRatio }}
      >
        {failed ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-4 text-center text-sm text-muted-foreground">
            <span>Photo could not be loaded.</span>
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={alt}
            className="h-full w-full object-contain"
            onError={() => setFailed(true)}
          />
        )}

        {visible && !failed
          ? detections.map((detection, index) => {
              const colour = index === 0 ? PRIORITY_HEX.CRITICAL : PRIORITY_HEX.HIGH;
              return (
                <div
                  key={detection.id ?? index}
                  className="pointer-events-none absolute rounded-[3px] border-2"
                  style={{
                    left: `${detection.bbox_x * 100}%`,
                    top: `${detection.bbox_y * 100}%`,
                    width: `${detection.bbox_width * 100}%`,
                    height: `${detection.bbox_height * 100}%`,
                    borderColor: colour,
                    boxShadow: `0 0 0 9999px rgba(0,0,0,0)`,
                  }}
                >
                  <span
                    className="absolute -top-[1px] left-0 -translate-y-full whitespace-nowrap rounded-t-[3px] px-1.5 py-0.5 text-[10px] font-semibold text-white"
                    style={{ backgroundColor: colour }}
                  >
                    {DAMAGE_TYPE_LABELS[detection.damage_type]} {Math.round(detection.confidence * 100)}%
                  </span>
                </div>
              );
            })
          : null}
      </div>

      {hasBoxes ? (
        <figcaption className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>
            {detections.length} damaged {detections.length === 1 ? "region" : "regions"} detected
          </span>
          <button
            type="button"
            onClick={() => setVisible((current) => !current)}
            className="rounded-md font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-pressed={visible}
          >
            {visible ? "Hide detection boxes" : "Show detection boxes"}
          </button>
        </figcaption>
      ) : null}
    </figure>
  );
}
