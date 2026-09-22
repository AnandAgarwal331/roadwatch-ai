import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A headline number is a stat tile, not a one-bar chart.
 *
 * Contract: label in sentence case, value in the same sans as everything else,
 * and an optional hint underneath. The value uses the font's proportional
 * figures - `tabular-nums` is for columns that must align, and makes a
 * standalone number look loose at this size.
 */

/** Compact form for large counts: 1,284 / 12.9K / 1.4M. */
export function compactNumber(value: number): string {
  if (!Number.isFinite(value)) return "-";
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (absolute >= 10_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
}

export type StatTone = "default" | "critical" | "warning" | "success";

const TONES: Record<StatTone, { value: string; icon: string }> = {
  default: {
    value: "text-foreground",
    icon: "bg-gradient-to-br from-primary/15 to-accent/15 text-primary",
  },
  critical: { value: "text-destructive", icon: "bg-destructive/10 text-destructive" },
  warning: { value: "text-warning", icon: "bg-warning/10 text-warning" },
  success: { value: "text-success", icon: "bg-success/10 text-success" },
};

interface StatCardProps {
  label: string;
  value: number | string;
  hint?: string;
  icon?: LucideIcon;
  tone?: StatTone;
  /** Turns the whole tile into a link to the filtered list behind the number. */
  href?: string;
  className?: string;
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
  href,
  className,
}: StatCardProps) {
  const tones = TONES[tone];

  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {Icon ? (
          <span
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-transform duration-200",
              href && "group-hover:scale-110 group-hover:rotate-3",
              tones.icon,
            )}
          >
            <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
          </span>
        ) : null}
      </div>

      <p className={cn("mt-2 font-display text-2xl font-semibold tracking-tight", tones.value)}>
        {typeof value === "number" ? compactNumber(value) : value}
      </p>

      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </>
  );

  const shared = cn(
    "rounded-xl border border-border bg-card p-4 shadow-card transition-all duration-200",
    href && [
      "group hover:-translate-y-0.5 hover:shadow-card-hover hover:border-border/60",
      "focus-visible:-translate-y-0.5 focus-visible:shadow-card-hover",
    ],
    className,
  );

  return href ? (
    <Link href={href} className={cn(shared, "block focus:outline-none")}>
      {body}
    </Link>
  ) : (
    <div className={cn(shared, "hover:shadow-card-hover")}>{body}</div>
  );
}

/**
 * A row of headline numbers. Never a grouped bar chart.
 *
 * Each tile fades up on mount, staggered left to right - reduced-motion
 * visitors get the plain, instant layout (see globals.css's blanket
 * `prefers-reduced-motion` override).
 */
export function StatGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-4 sm:grid-cols-2 lg:grid-cols-4", className)}>
      {React.Children.map(children, (child, index) => (
        <div className="animate-fade-up" style={{ animationDelay: `${index * 60}ms` }}>
          {child}
        </div>
      ))}
    </div>
  );
}
