import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * Wordmark.
 *
 * The mark is a road converging to a horizon with an alert dot on it - drawn
 * inline so it inherits the current colour and needs no asset request.
 */
export function Logo({
  href = "/",
  className,
  showText = true,
}: {
  href?: string | null;
  className?: string;
  showText?: boolean;
}) {
  const content = (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span className="glow-primary flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-accent text-primary-foreground">
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" aria-hidden="true" fill="none">
          <path
            d="M4 21 9.2 4h5.6L20 21"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M12 7.5v2.2M12 12.4v2.2"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            opacity="0.75"
          />
          <circle cx="12" cy="18.4" r="1.9" fill="currentColor" />
        </svg>
      </span>
      {showText ? (
        <span className="font-display text-[15px] font-semibold tracking-tight">
          RoadWatch<span className="text-brand-gradient"> AI</span>
        </span>
      ) : null}
    </span>
  );

  if (!href) return content;

  return (
    <Link href={href} className="rounded-md focus-visible:ring-2 focus-visible:ring-ring">
      <span className="sr-only">RoadWatch AI home</span>
      <span aria-hidden="true">{content}</span>
    </Link>
  );
}
