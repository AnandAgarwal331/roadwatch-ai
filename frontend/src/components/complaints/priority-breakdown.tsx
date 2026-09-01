import { Info } from "lucide-react";

import { Progress } from "@/components/ui/progress";
import { PRIORITY_DISCLAIMER, PRIORITY_LABELS, PRIORITY_STYLES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { PriorityAssessment, PriorityFactor, PriorityLevel } from "@/types";

const BAR_COLOURS: Record<PriorityFactor["key"], string> = {
  severity: "bg-priority-critical",
  traffic: "bg-priority-high",
  location: "bg-priority-medium",
  history: "bg-priority-low",
};

interface PriorityBreakdownProps {
  assessment: PriorityAssessment;
  className?: string;
  /** Hide the score header when the surrounding card already shows it. */
  showHeader?: boolean;
}

/**
 * The explainable score.
 *
 * Every factor shows its 0-10 value, its weight, and the points it contributed
 * out of its maximum - so the total is arithmetic the reader can follow, not a
 * number handed down. This is the feature the whole product rests on.
 */
export function PriorityBreakdown({
  assessment,
  className,
  showHeader = true,
}: PriorityBreakdownProps) {
  const total = assessment.factors.reduce((sum, factor) => sum + factor.points, 0);

  return (
    <div className={cn("space-y-5", className)}>
      {showHeader ? (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Priority score
            </p>
            <p className="mt-1 flex items-baseline gap-1.5">
              <span className="text-4xl font-semibold tabular-nums tracking-tight">
                {assessment.total_score.toFixed(1)}
              </span>
              <span className="text-lg text-muted-foreground">/ 100</span>
            </p>
          </div>
          <PriorityPill level={assessment.level} />
        </div>
      ) : null}

      <ul className="space-y-4">
        {assessment.factors.map((factor) => (
          <li key={factor.key}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium">{factor.label}</span>
              <span className="tabular-nums text-muted-foreground">
                <span className="font-medium text-foreground">{factor.value.toFixed(1)}</span>
                /10
                <span className="mx-1.5 text-border">|</span>
                <span className="font-medium text-foreground">+{factor.points.toFixed(1)}</span>
                <span className="text-muted-foreground"> of {factor.max_points.toFixed(0)} pts</span>
              </span>
            </div>

            <Progress
              value={factor.points}
              max={factor.max_points}
              className="mt-2 h-1.5"
              indicatorClassName={BAR_COLOURS[factor.key]}
              label={`${factor.label}: ${factor.value.toFixed(1)} out of 10, contributing ${factor.points.toFixed(1)} of ${factor.max_points.toFixed(0)} points`}
            />

            {factor.note ? (
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                {capitalise(factor.note)}
              </p>
            ) : null}
          </li>
        ))}
      </ul>

      <div className="flex items-baseline justify-between border-t border-border pt-3 text-sm font-medium">
        <span>Total</span>
        <span className="tabular-nums">
          {total.toFixed(1)}
          {assessment.weather_multiplier > 1 ? (
            <span className="ml-1.5 font-normal text-muted-foreground">
              &times; {assessment.weather_multiplier.toFixed(2)} weather ={" "}
              {assessment.total_score.toFixed(1)}
            </span>
          ) : (
            <span className="text-muted-foreground"> / 100</span>
          )}
        </span>
      </div>

      <p className="rounded-lg bg-muted/60 p-3 text-sm leading-relaxed text-muted-foreground">
        {assessment.explanation}
      </p>

      <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
        <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{assessment.disclaimer || PRIORITY_DISCLAIMER}</span>
      </p>
    </div>
  );
}

export function PriorityPill({ level, className }: { level: PriorityLevel; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide",
        PRIORITY_STYLES[level],
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {PRIORITY_LABELS[level]}
    </span>
  );
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
