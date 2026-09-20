"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

interface BeforeAfterSliderProps {
  beforeSrc: string;
  beforeAlt: string;
  afterSrc: string;
  afterAlt: string;
  className?: string;
}

/**
 * The reported damage vs. the repair crew's own evidence of the fix, one
 * image revealed by dragging over the other. A native range input drives it -
 * full keyboard support (arrow keys) and screen-reader semantics for free,
 * styled invisible except for its thumb, which doubles as the drag handle.
 */
export function BeforeAfterSlider({
  beforeSrc,
  beforeAlt,
  afterSrc,
  afterAlt,
  className,
}: BeforeAfterSliderProps) {
  const [position, setPosition] = React.useState(50);

  return (
    <div
      className={cn(
        "relative aspect-[4/3] select-none overflow-hidden rounded-xl border border-border bg-muted",
        className,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={afterSrc} alt={afterAlt} className="absolute inset-0 h-full w-full object-cover" draggable={false} />

      <div
        className="absolute inset-0 overflow-hidden"
        style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={beforeSrc} alt={beforeAlt} className="h-full w-full object-cover" draggable={false} />
      </div>

      <div
        className="pointer-events-none absolute inset-y-0 w-0.5 bg-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.15)]"
        style={{ left: `${position}%` }}
        aria-hidden="true"
      />

      <span className="pointer-events-none absolute left-2.5 top-2.5 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white">
        Before
      </span>
      <span className="pointer-events-none absolute right-2.5 top-2.5 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white">
        After
      </span>

      {/* Spans the full container - the thumb's position already tracks
          `value` against `min`/`max` on its own, so no extra offset math is
          needed here to keep it aligned with the clip-path above. */}
      <input
        type="range"
        min={0}
        max={100}
        value={position}
        onChange={(event) => setPosition(Number(event.target.value))}
        aria-label="Drag to compare the reported damage with the completed repair"
        className="compare-slider absolute inset-0 h-full w-full cursor-ew-resize"
      />
    </div>
  );
}
