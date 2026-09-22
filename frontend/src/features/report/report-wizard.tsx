"use client";

import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, Send } from "lucide-react";
import * as React from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AnalysisProgress, AnalysisResult } from "@/features/report/analysis-result";
import { DetailsStep, type DetailsValue } from "@/features/report/details-step";
import { LocationStep, type LocationValue } from "@/features/report/location-step";
import { PhotoStep, type PhotoValue } from "@/features/report/photo-step";
import { ApiError, apiRequest, errorMessage } from "@/lib/api";
import { shrinkForUpload } from "@/lib/shrink-image";
import { cn } from "@/lib/utils";
import type { ComplaintCreateResponse } from "@/types";

const STEPS = [
  { id: "photo", title: "Photo", description: "Show us the problem" },
  { id: "location", title: "Location", description: "Where is it?" },
  { id: "details", title: "Details", description: "Tell us more" },
  { id: "review", title: "Review", description: "Check and submit" },
] as const;

type StepId = (typeof STEPS)[number]["id"];

export function ReportWizard() {
  const [stepIndex, setStepIndex] = React.useState(0);
  const [photo, setPhoto] = React.useState<PhotoValue | null>(null);
  const [location, setLocation] = React.useState<LocationValue | null>(null);
  const [details, setDetails] = React.useState<DetailsValue>({
    description: "",
    damageType: null,
    roadName: "",
  });
  const [stepError, setStepError] = React.useState<string | null>(null);

  // The preview URL must outlive the Photo step, since Review shows it too.
  // Revoke only when the photo itself changes or the wizard unmounts.
  React.useEffect(() => {
    return () => {
      if (photo?.previewUrl) URL.revokeObjectURL(photo.previewUrl);
    };
  }, [photo?.previewUrl]);

  const submission = useMutation<ComplaintCreateResponse, unknown, void>({
    mutationFn: async () => {
      if (!location) throw new Error("A location is required.");

      const form = new FormData();
      form.append("latitude", String(location.latitude));
      form.append("longitude", String(location.longitude));
      if (location.accuracyMeters) {
        form.append("accuracy_meters", String(Math.round(location.accuracyMeters)));
      }
      if (location.address?.trim()) form.append("address", location.address.trim());
      if (details.description.trim()) form.append("description", details.description.trim());
      if (details.roadName.trim()) form.append("road_name", details.roadName.trim());
      if (details.damageType) form.append("reported_damage_type", details.damageType);
      if (photo) {
        const upload = await shrinkForUpload(photo.file);
        form.append("photo", upload, upload.name);
      }

      return apiRequest<ComplaintCreateResponse>("/complaints", { method: "POST", body: form });
    },
  });

  const currentStep: StepId = STEPS[stepIndex].id;

  function validateStep(): string | null {
    if (currentStep === "location" && !location) {
      return "Please choose a location before continuing.";
    }
    return null;
  }

  function goNext() {
    const message = validateStep();
    if (message) {
      setStepError(message);
      return;
    }
    setStepError(null);
    setStepIndex((index) => Math.min(index + 1, STEPS.length - 1));
  }

  function goBack() {
    setStepError(null);
    setStepIndex((index) => Math.max(index - 1, 0));
  }

  // -- Submitted: the wizard is replaced by the outcome ------------------
  if (submission.isSuccess) {
    return <AnalysisResult result={submission.data} />;
  }

  if (submission.isPending) {
    return (
      <Card>
        <CardContent className="p-6">
          <AnalysisProgress />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Stepper current={stepIndex} />

      <Card>
        <CardContent className="p-5 sm:p-6">
          <div className="mb-5">
            <h2 className="text-lg font-semibold">{STEPS[stepIndex].title}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{STEPS[stepIndex].description}</p>
          </div>

          {currentStep === "photo" ? <PhotoStep value={photo} onChange={setPhoto} /> : null}
          {currentStep === "location" ? (
            <LocationStep value={location} onChange={setLocation} />
          ) : null}
          {currentStep === "details" ? <DetailsStep value={details} onChange={setDetails} /> : null}
          {currentStep === "review" ? (
            <ReviewStep photo={photo} location={location} details={details} />
          ) : null}

          {stepError ? (
            <Alert variant="warning" className="mt-5" title={stepError} />
          ) : null}

          {submission.isError ? (
            <Alert variant="destructive" className="mt-5" title="Your report could not be submitted">
              <p>{errorMessage(submission.error)}</p>
              {submission.error instanceof ApiError && submission.error.status === 401 ? (
                <p className="mt-1">
                  Your session may have expired. Please sign in again and retry.
                </p>
              ) : null}
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="ghost"
          onClick={goBack}
          disabled={stepIndex === 0}
          className={cn(stepIndex === 0 && "invisible")}
        >
          <ArrowLeft aria-hidden="true" />
          Back
        </Button>

        {currentStep === "review" ? (
          <Button
            type="button"
            size="lg"
            onClick={() => submission.mutate()}
            loading={submission.isPending}
          >
            <Send aria-hidden="true" />
            Analyse and submit
          </Button>
        ) : (
          <Button type="button" onClick={goNext}>
            Continue
            <ArrowRight aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  );
}

function Stepper({ current }: { current: number }) {
  return (
    <ol className="flex items-center gap-2" aria-label="Report progress">
      {STEPS.map((step, index) => {
        const state = index < current ? "done" : index === current ? "active" : "todo";

        return (
          <li key={step.id} className="flex flex-1 items-center gap-2">
            <span
              aria-current={state === "active" ? "step" : undefined}
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors",
                state === "done" && "border-primary bg-primary text-primary-foreground",
                state === "active" && "border-primary bg-primary/10 text-primary",
                state === "todo" && "border-border bg-card text-muted-foreground",
              )}
            >
              {state === "done" ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : index + 1}
              <span className="sr-only">
                {step.title}
                {state === "done" ? " (completed)" : state === "active" ? " (current)" : ""}
              </span>
            </span>

            <span
              className={cn(
                "hidden text-sm sm:inline",
                state === "active" ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {step.title}
            </span>

            {index < STEPS.length - 1 ? (
              <span
                className={cn(
                  "h-px flex-1 transition-colors",
                  index < current ? "bg-primary" : "bg-border",
                )}
                aria-hidden="true"
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function ReviewStep({
  photo,
  location,
  details,
}: {
  photo: PhotoValue | null;
  location: LocationValue | null;
  details: DetailsValue;
}) {
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Check the details below. When you submit, the photo is analysed, the location is checked
        against nearby facilities, traffic and past reports, and a priority score is calculated.
      </p>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="overflow-hidden rounded-lg border border-border bg-muted">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photo.previewUrl}
              alt="The photo you are about to submit"
              className="h-48 w-full object-cover"
            />
          ) : (
            <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
              No photo attached
            </div>
          )}
        </div>

        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Location</dt>
            <dd className="mt-0.5 font-mono tabular-nums">
              {location
                ? `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`
                : "Not set"}
            </dd>
          </div>
          {location?.address ? (
            <div>
              <dt className="text-xs text-muted-foreground">Landmark</dt>
              <dd className="mt-0.5">{location.address}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-xs text-muted-foreground">Road</dt>
            <dd className="mt-0.5">{details.roadName || "Not specified"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Your category</dt>
            <dd className="mt-0.5">
              {details.damageType ? details.damageType.replace(/_/g, " ").toLowerCase() : "Not specified"}
            </dd>
          </div>
        </dl>
      </div>

      <div>
        <p className="text-xs text-muted-foreground">Description</p>
        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
          {details.description.trim() || "No description provided."}
        </p>
      </div>
    </div>
  );
}
