"use client";

import { DAMAGE_ICONS } from "@/components/complaints/badges";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DAMAGE_TYPE_LABELS, REPORTABLE_DAMAGE_TYPES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { DamageType } from "@/types";

export interface DetailsValue {
  description: string;
  damageType: DamageType | null;
  roadName: string;
}

interface DetailsStepProps {
  value: DetailsValue;
  onChange: (value: DetailsValue) => void;
  errors?: Partial<Record<keyof DetailsValue, string>>;
}

const MAX_DESCRIPTION = 2000;

export function DetailsStep({ value, onChange, errors }: DetailsStepProps) {
  return (
    <div className="space-y-6">
      <fieldset>
        <legend className="text-sm font-medium">What kind of problem is it?</legend>
        <p className="mt-1 text-sm text-muted-foreground">
          Optional. The AI makes its own assessment from the photo - your choice is used if it
          cannot decide confidently.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {REPORTABLE_DAMAGE_TYPES.map((type) => {
            const Icon = DAMAGE_ICONS[type];
            const selected = value.damageType === type;

            return (
              <button
                key={type}
                type="button"
                aria-pressed={selected}
                onClick={() =>
                  onChange({ ...value, damageType: selected ? null : type })
                }
                className={cn(
                  "flex items-center gap-2.5 rounded-lg border p-3 text-left text-sm transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  selected
                    ? "border-primary bg-primary/5 font-medium text-foreground"
                    : "border-border bg-card text-muted-foreground hover:border-input hover:bg-muted",
                )}
              >
                <Icon
                  className={cn("h-4 w-4 shrink-0", selected ? "text-primary" : "")}
                  aria-hidden="true"
                />
                <span className="truncate">{DAMAGE_TYPE_LABELS[type]}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <Field
        id="description"
        label="Describe the problem"
        hint={`What is wrong, and how is it affecting people? ${value.description.length}/${MAX_DESCRIPTION}`}
        error={errors?.description}
      >
        <Textarea
          id="description"
          value={value.description}
          maxLength={MAX_DESCRIPTION}
          rows={5}
          placeholder="e.g. Deep pothole in the left lane just after the junction. Two-wheelers are swerving into traffic to avoid it."
          aria-describedby={errors?.description ? "description-error" : "description-hint"}
          aria-invalid={errors?.description ? true : undefined}
          onChange={(event) => onChange({ ...value, description: event.target.value })}
        />
      </Field>

      <Field
        id="road-name"
        label="Road name"
        hint="If you know it. Used to group repeat problems on the same stretch."
      >
        <Input
          id="road-name"
          value={value.roadName}
          maxLength={200}
          placeholder="e.g. Old Airport Road"
          aria-describedby="road-name-hint"
          onChange={(event) => onChange({ ...value, roadName: event.target.value })}
        />
      </Field>
    </div>
  );
}
