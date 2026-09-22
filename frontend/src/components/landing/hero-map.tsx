import { cn } from "@/lib/utils";

interface Pin {
  x: number;
  y: number;
  level: "critical" | "high" | "medium" | "low";
  label: string;
}

/** Illustrative markers - shaped like a real queue, not claiming to be one. */
const PINS: Pin[] = [
  { x: 27, y: 32, level: "critical", label: "Critical issue near a hospital" },
  { x: 62, y: 24, level: "high", label: "High priority issue" },
  { x: 44, y: 55, level: "high", label: "High priority issue" },
  { x: 74, y: 61, level: "medium", label: "Medium priority issue" },
  { x: 18, y: 68, level: "medium", label: "Medium priority issue" },
  { x: 55, y: 78, level: "low", label: "Low priority issue" },
  { x: 86, y: 40, level: "low", label: "Low priority issue" },
];

const PIN_COLOURS: Record<Pin["level"], string> = {
  critical: "bg-priority-critical",
  high: "bg-priority-high",
  medium: "bg-priority-medium",
  low: "bg-priority-low",
};

/**
 * Stylised city map for the hero.
 *
 * Deliberately an illustration rather than a live Leaflet instance: the hero
 * must paint instantly, and shipping tile requests plus ~40KB of map library
 * for decoration would be the wrong trade. The real map is one click away.
 */
export function HeroMap({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-border bg-card shadow-panel ring-1 ring-primary/10",
        className,
      )}
      role="img"
      aria-label="Illustration of a city map with road issue markers coloured by priority"
    >
      {/* Street grid */}
      <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
        <defs>
          <pattern id="rw-grid" width="52" height="52" patternUnits="userSpaceOnUse">
            <path
              d="M52 0H0v52"
              fill="none"
              stroke="hsl(var(--border))"
              strokeWidth="1"
              opacity="0.9"
            />
          </pattern>
          <radialGradient id="rw-glow" cx="27%" cy="32%" r="65%">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.16" />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="100%" height="100%" fill="hsl(var(--muted))" opacity="0.45" />
        <rect width="100%" height="100%" fill="url(#rw-grid)" />
        <rect width="100%" height="100%" fill="url(#rw-glow)" />

        {/* Arterial roads */}
        <path
          d="M-20 132 L360 62"
          stroke="hsl(var(--border))"
          strokeWidth="14"
          strokeLinecap="round"
          opacity="0.85"
        />
        <path
          d="M96 -20 L150 400"
          stroke="hsl(var(--border))"
          strokeWidth="12"
          strokeLinecap="round"
          opacity="0.75"
        />
        <path
          d="M-20 268 L400 214"
          stroke="hsl(var(--border))"
          strokeWidth="10"
          strokeLinecap="round"
          opacity="0.7"
        />
      </svg>

      {PINS.map((pin, index) => (
        <span
          key={index}
          className="absolute -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
          title={pin.label}
        >
          {pin.level === "critical" ? (
            <span
              className={cn(
                "absolute inset-0 -m-2 animate-ping rounded-full opacity-30",
                PIN_COLOURS[pin.level],
              )}
              aria-hidden="true"
            />
          ) : null}
          <span
            className={cn(
              "relative block rounded-full border-2 border-card shadow-md",
              PIN_COLOURS[pin.level],
              pin.level === "critical" ? "h-4 w-4" : pin.level === "high" ? "h-3.5 w-3.5" : "h-3 w-3",
            )}
          />
        </span>
      ))}

      {/* Floating summary card, echoing the real breakdown UI. */}
      <div className="glow-primary absolute bottom-4 left-4 right-4 animate-float rounded-xl border border-border bg-card/95 p-4 backdrop-blur sm:right-auto sm:w-72">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] text-muted-foreground">RW-2026-001024</span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-priority-critical/30 bg-priority-critical/10 px-2 py-0.5 text-[11px] font-semibold text-priority-critical">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-glow-pulse rounded-full bg-current" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
            </span>
            Critical
          </span>
        </div>

        <p className="mt-2 text-sm font-medium">Pothole &middot; 53m from a hospital</p>

        <dl className="mt-3 space-y-1.5">
          {[
            { label: "Visual severity", value: "9.9/10", width: "99%", tone: "bg-priority-critical" },
            { label: "Traffic", value: "9/10", width: "90%", tone: "bg-priority-high" },
            { label: "Location risk", value: "9.3/10", width: "93%", tone: "bg-priority-medium" },
          ].map((row) => (
            <div key={row.label} className="grid grid-cols-[1fr_auto] items-center gap-2">
              <dt className="text-[11px] text-muted-foreground">{row.label}</dt>
              <dd className="text-[11px] font-medium tabular-nums">{row.value}</dd>
              <div className="col-span-2 h-1 overflow-hidden rounded-full bg-muted">
                <div className={cn("h-full rounded-full", row.tone)} style={{ width: row.width }} />
              </div>
            </div>
          ))}
        </dl>

        <p className="mt-3 border-t border-border pt-2 text-[11px] text-muted-foreground">
          Priority <span className="font-display font-semibold text-foreground tabular-nums">87.5</span> / 100
        </p>
      </div>
    </div>
  );
}
