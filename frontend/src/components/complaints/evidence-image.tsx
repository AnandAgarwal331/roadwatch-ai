"use client";

import * as React from "react";

interface EvidenceImageProps {
  src: string;
  alt: string;
  className?: string;
}

/** A single repair-evidence photo with a graceful fallback if it fails to load. */
export function EvidenceImage({ src, alt, className }: EvidenceImageProps) {
  const [failed, setFailed] = React.useState(false);

  if (failed) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg border border-border bg-muted text-sm text-muted-foreground">
        Photo could not be loaded
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className={className} onError={() => setFailed(true)} />
  );
}
