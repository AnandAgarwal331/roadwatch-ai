"use client";

import { Camera, ImageUp, RotateCcw, Upload } from "lucide-react";
import * as React from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ACCEPTED_IMAGE_TYPES, MAX_UPLOAD_MB } from "@/lib/constants";
import { cn } from "@/lib/utils";

export interface PhotoValue {
  file: File;
  previewUrl: string;
}

interface PhotoStepProps {
  value: PhotoValue | null;
  onChange: (value: PhotoValue | null) => void;
}

/** Mirrors the server rules so obvious problems are caught before upload. */
function validate(file: File): string | null {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    return "That file type is not supported. Please choose a JPEG, PNG or WebP image.";
  }
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
    return `That image is ${(file.size / (1024 * 1024)).toFixed(1)}MB. Please choose a file under ${MAX_UPLOAD_MB}MB.`;
  }
  if (file.size === 0) {
    return "That file appears to be empty. Please choose another photo.";
  }
  return null;
}

export function PhotoStep({ value, onChange }: PhotoStepProps) {
  const [error, setError] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const cameraInput = React.useRef<HTMLInputElement>(null);

  // Object URLs leak until revoked; tie the lifetime to the preview.
  React.useEffect(() => {
    return () => {
      if (value?.previewUrl) URL.revokeObjectURL(value.previewUrl);
    };
  }, [value?.previewUrl]);

  function accept(file: File | undefined) {
    if (!file) return;

    const message = validate(file);
    if (message) {
      setError(message);
      return;
    }

    setError(null);
    onChange({ file, previewUrl: URL.createObjectURL(file) });
  }

  function clear() {
    setError(null);
    onChange(null);
    if (fileInput.current) fileInput.current.value = "";
    if (cameraInput.current) cameraInput.current.value = "";
  }

  if (value) {
    return (
      <div className="space-y-4">
        <div className="overflow-hidden rounded-xl border border-border bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value.previewUrl}
            alt="Preview of the road problem you are reporting"
            className="max-h-[420px] w-full object-contain"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{value.file.name}</span>{" "}
            &middot; {(value.file.size / (1024 * 1024)).toFixed(1)}MB
          </p>
          <Button type="button" variant="outline" size="sm" onClick={clear}>
            <RotateCcw aria-hidden="true" />
            Choose a different photo
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          accept(event.dataTransfer.files?.[0]);
        }}
        className={cn(
          "rounded-xl border-2 border-dashed p-8 text-center transition-colors sm:p-12",
          dragging ? "border-primary bg-primary/5" : "border-border bg-muted/30",
        )}
      >
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-card shadow-card">
          <ImageUp className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
        </div>

        <p className="mt-4 text-sm font-medium">Add a photo of the problem</p>
        <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">
          Drag an image here, or choose one below. A clear, straight-on shot helps the analysis most.
        </p>

        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <Button type="button" onClick={() => fileInput.current?.click()}>
            <Upload aria-hidden="true" />
            Choose a photo
          </Button>
          {/* Opens the camera directly on a phone. */}
          <Button
            type="button"
            variant="outline"
            className="sm:hidden"
            onClick={() => cameraInput.current?.click()}
          >
            <Camera aria-hidden="true" />
            Take a photo
          </Button>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          JPEG, PNG or WebP &middot; up to {MAX_UPLOAD_MB}MB
        </p>

        <input
          ref={fileInput}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES.join(",")}
          className="sr-only"
          aria-label="Choose a photo of the road problem"
          onChange={(event) => accept(event.target.files?.[0])}
        />
        <input
          ref={cameraInput}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          aria-label="Take a photo of the road problem"
          onChange={(event) => accept(event.target.files?.[0])}
        />
      </div>

      {error ? (
        <Alert variant="destructive" title="That photo could not be used">
          <p>{error}</p>
        </Alert>
      ) : null}

      <Alert variant="info" title="No photo to hand?">
        <p>
          You can continue without one. The report will still be scored on location, traffic and
          history, but it will be queued for manual review instead of AI analysis.
        </p>
      </Alert>
    </div>
  );
}
