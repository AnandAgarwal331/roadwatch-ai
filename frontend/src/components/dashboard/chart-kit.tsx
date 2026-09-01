"use client";

import { LineChart as LineChartIcon, Table2 } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  CHART_COLORS,
  CHART_COLORS_DARK,
  CHART_SEQUENTIAL,
  CHART_SEQUENTIAL_DARK,
  PRIORITY_RAMP,
  PRIORITY_RAMP_DARK,
} from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { PriorityLevel } from "@/types";

/**
 * Chart primitives.
 *
 * Every figure in the console is built from these, so the whole console reads
 * as one system: the same marks, the same recessive grid, the same tooltip,
 * and a table view behind every chart so no value is reachable only by
 * hovering a colour.
 */

/** Mark specs, fixed across every chart. */
export const MARK = {
  /** Bars never fill their band; the leftover is deliberate air. */
  barSize: 24,
  /** 4px rounded data-end, square at the baseline. */
  radiusY: [4, 4, 0, 0] as [number, number, number, number],
  radiusX: [0, 4, 4, 0] as [number, number, number, number],
  lineWidth: 2,
  dotRadius: 4,
  /** The separator between touching marks, painted in the surface colour. */
  gap: 2,
} as const;

/**
 * Dark mode is *selected*, not flipped: each mode has its own steps, validated
 * against its own surface. This watches the `dark` class Tailwind toggles.
 */
export function useIsDark(): boolean {
  const [dark, setDark] = React.useState(false);

  React.useEffect(() => {
    const root = document.documentElement;
    const read = () => setDark(root.classList.contains("dark"));
    read();

    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return dark;
}

export interface ChartTheme {
  /** Categorical hues, assigned in fixed order and never cycled. */
  series: readonly string[];
  /** One hue for magnitude, where the category already sits on the axis. */
  sequential: string;
  /** Ordinal severity ramp, LOW to CRITICAL. */
  priority: Record<PriorityLevel, string>;
  /** The chart surface: what the gaps and rings are painted in. */
  surface: string;
  grid: string;
  axis: string;
}

export function useChartTheme(): ChartTheme {
  const dark = useIsDark();

  return React.useMemo(
    () => ({
      series: dark ? CHART_COLORS_DARK : CHART_COLORS,
      sequential: dark ? CHART_SEQUENTIAL_DARK : CHART_SEQUENTIAL,
      priority: dark ? PRIORITY_RAMP_DARK : PRIORITY_RAMP,
      surface: "hsl(var(--card))",
      grid: "hsl(var(--border))",
      axis: "hsl(var(--muted-foreground))",
    }),
    [dark],
  );
}

/** Recessive axis styling shared by every chart. */
export function axisProps(theme: ChartTheme) {
  return {
    stroke: theme.axis,
    tick: { fill: theme.axis, fontSize: 12 },
    tickLine: false,
    axisLine: { stroke: theme.grid },
  } as const;
}

interface TooltipEntry {
  name?: string | number;
  value?: number | string;
  color?: string;
}

/**
 * Tooltip body.
 *
 * Values wear text tokens; identity comes from the swatch beside them, never
 * from colouring the text.
 */
export function ChartTooltip({
  active,
  payload,
  label,
  formatter,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  formatter?: (value: number | string, name: string) => string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-panel">
      {label !== undefined && label !== "" ? (
        <p className="mb-1.5 font-medium text-foreground">{label}</p>
      ) : null}
      <ul className="space-y-1">
        {payload.map((item, index) => (
          <li key={index} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
              style={{ backgroundColor: item.color }}
            />
            <span className="text-muted-foreground">{String(item.name ?? "")}</span>
            <span className="ml-auto font-medium tabular-nums text-foreground">
              {formatter && item.value !== undefined
                ? formatter(item.value, String(item.name ?? ""))
                : item.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Legend: always present for two or more series. */
export function ChartLegend({
  items,
  className,
}: {
  items: { label: string; color: string }[];
  className?: string;
}) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5", className)}>
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 rounded-[2px]"
            style={{ backgroundColor: item.color }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

export interface TableColumn<T> {
  key: string;
  header: string;
  /** Right-aligned and tabular when the cell is a number. */
  numeric?: boolean;
  cell: (row: T) => React.ReactNode;
}

/** The table behind every chart: the same numbers, reachable without hover. */
export function ChartTable<T>({
  rows,
  columns,
  caption,
}: {
  rows: T[];
  columns: TableColumn<T>[];
  caption: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border text-left">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  "whitespace-nowrap px-3 py-2 text-xs font-medium text-muted-foreground",
                  column.numeric && "text-right",
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-b border-border/60 last:border-0">
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn("px-3 py-2", column.numeric && "text-right tabular-nums")}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Figure wrapper: title, optional legend, the plot, and a toggle to the same
 * data as a table. The table is not a fallback for failure; it is how the
 * numbers stay available to anyone who cannot read the colours.
 */
export function ChartCard<T>({
  title,
  description,
  legend,
  table,
  className,
  children,
}: {
  title: string;
  description?: string;
  legend?: { label: string; color: string }[];
  table?: { rows: T[]; columns: TableColumn<T>[] };
  className?: string;
  children: React.ReactNode;
}) {
  const [showTable, setShowTable] = React.useState(false);
  const headingId = React.useId();

  return (
    <figure
      aria-labelledby={headingId}
      className={cn("rounded-xl border border-border bg-card p-4 shadow-card sm:p-5", className)}
    >
      <figcaption className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={headingId} className="text-sm font-semibold text-foreground">
            {title}
          </h3>
          {description ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>

        {table ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 px-2 text-xs"
            aria-pressed={showTable}
            onClick={() => setShowTable((value) => !value)}
          >
            {showTable ? (
              <>
                <LineChartIcon aria-hidden="true" />
                Chart
              </>
            ) : (
              <>
                <Table2 aria-hidden="true" />
                Table
              </>
            )}
          </Button>
        ) : null}
      </figcaption>

      {legend && legend.length > 1 && !showTable ? (
        <ChartLegend items={legend} className="mb-3" />
      ) : null}

      {showTable && table ? (
        <ChartTable rows={table.rows} columns={table.columns} caption={title} />
      ) : (
        children
      )}
    </figure>
  );
}

/** Nothing to plot yet; keeps the figure height so the grid does not jump. */
export function ChartEmpty({ message = "No data for this period yet." }: { message?: string }) {
  return (
    <div className="flex h-[240px] items-center justify-center rounded-lg bg-muted/30 text-sm text-muted-foreground">
      {message}
    </div>
  );
}
