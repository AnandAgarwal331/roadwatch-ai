import { Check, Circle } from "lucide-react";

import { STATUS_FLOW, STATUS_LABELS } from "@/lib/constants";
import { cn, formatDateTime } from "@/lib/utils";
import type { ComplaintStatus, StatusHistoryEntry } from "@/types";

interface StatusTimelineProps {
  history: StatusHistoryEntry[];
  currentStatus: ComplaintStatus;
  className?: string;
}

/**
 * The lifecycle, with what actually happened.
 *
 * Rejected and duplicate reports leave the normal flow, so those render as a
 * plain chronological log rather than being forced into the six-step ladder.
 */
export function StatusTimeline({ history, currentStatus, className }: StatusTimelineProps) {
  const offFlow = currentStatus === "REJECTED" || currentStatus === "DUPLICATE";

  if (offFlow) {
    return (
      <ol className={cn("space-y-4", className)}>
        {history.map((entry) => (
          <li key={entry.id} className="flex gap-3">
            <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-card">
              <Circle className="h-2 w-2 fill-current text-muted-foreground" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{STATUS_LABELS[entry.to_status]}</p>
              <p className="text-xs text-muted-foreground">{formatDateTime(entry.created_at)}</p>
              {entry.note ? (
                <p className="mt-1 text-sm text-muted-foreground">{entry.note}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    );
  }

  // Latest entry per status, so a re-opened report shows the most recent move.
  const reached = new Map<ComplaintStatus, StatusHistoryEntry>();
  for (const entry of history) {
    reached.set(entry.to_status, entry);
  }

  const currentIndex = STATUS_FLOW.indexOf(currentStatus);

  return (
    <ol className={cn("relative space-y-6", className)}>
      {STATUS_FLOW.map((status, index) => {
        const entry = reached.get(status);
        const isDone = entry !== undefined || (currentIndex >= 0 && index < currentIndex);
        const isCurrent = status === currentStatus;
        const isLast = index === STATUS_FLOW.length - 1;

        return (
          <li key={status} className="relative flex gap-3">
            {!isLast ? (
              <span
                className={cn(
                  "absolute left-[11px] top-6 h-[calc(100%+0.5rem)] w-px",
                  isDone ? "bg-primary/40" : "bg-border",
                )}
                aria-hidden="true"
              />
            ) : null}

            <span
              className={cn(
                "relative z-10 mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                isDone
                  ? "border-primary bg-primary text-primary-foreground"
                  : isCurrent
                    ? "border-primary bg-card text-primary"
                    : "border-border bg-card text-muted-foreground",
              )}
            >
              {isDone ? (
                <Check className="h-3 w-3" aria-hidden="true" />
              ) : (
                <Circle className="h-1.5 w-1.5 fill-current" aria-hidden="true" />
              )}
            </span>

            <div className="min-w-0 flex-1 pb-1">
              <p
                className={cn(
                  "text-sm",
                  isDone || isCurrent ? "font-medium" : "text-muted-foreground",
                )}
              >
                {STATUS_LABELS[status]}
                {isCurrent ? (
                  <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                    Current
                  </span>
                ) : null}
              </p>

              {entry ? (
                <>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatDateTime(entry.created_at)}
                  </p>
                  {entry.note ? (
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      {entry.note}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="mt-0.5 text-xs text-muted-foreground">Not yet reached</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
