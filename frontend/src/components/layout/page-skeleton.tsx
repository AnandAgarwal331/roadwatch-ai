import { Skeleton } from "@/components/ui/skeleton";

/**
 * What a page shows the instant a link is clicked, while its data loads.
 *
 * Next.js swaps this in immediately (and prefetches it), so navigation
 * responds at once instead of the old page sitting frozen until the server
 * finishes. It is only a placeholder for the shape of a typical page - a title,
 * a row of figures, and a list - not a copy of any particular one. Inside a
 * dashboard shell, which supplies its own padding, pass `contained={false}`.
 */
export function PageSkeleton({ contained = true }: { contained?: boolean }) {
  return (
    <div
      className={contained ? "container space-y-8 py-8" : "space-y-8"}
      role="status"
      aria-busy="true"
    >
      <span className="sr-only">Loading...</span>

      <div className="space-y-3">
        <Skeleton className="h-8 w-64 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>

      <div className="space-y-3">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
    </div>
  );
}
