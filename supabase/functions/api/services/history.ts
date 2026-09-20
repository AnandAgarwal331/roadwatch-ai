// Ported from backend/app/services/history.py. Answers "has this spot been
// reported before, how recently, and did anyone fix it?" as a 0-10 factor.
// See the Python docstring for the recency/unresolved weighting rationale.

import type { SupabaseClient } from "@supabase/supabase-js";
import { settings } from "../_shared/config.ts";
import { CLOSED_STATUSES, type ComplaintStatus } from "../_shared/enums.ts";
import { findNearby } from "../repositories/complaint.ts";

const AGE_WEIGHTS: [number, number][] = [
  [7, 1.6],
  [30, 1.0],
  [90, 0.5],
  [365, 0.25],
];
const OLDER_WEIGHT = 0.1;

const UNRESOLVED_MULTIPLIER = 1.5;
const RESOLVED_MULTIPLIER = 0.5;

export interface HistoryResult {
  score: number;
  totalPrevious: number;
  last7Days: number;
  last30Days: number;
  unresolved: number;
  resolved: number;
  radiusMeters: number;
  explanation: string;
}

export function historyAsSignals(r: HistoryResult): Record<string, number> {
  return {
    total_previous: r.totalPrevious,
    last_7_days: r.last7Days,
    last_30_days: r.last30Days,
    unresolved: r.unresolved,
    resolved: r.resolved,
    radius_meters: r.radiusMeters,
  };
}

function ageWeight(ageDays: number): number {
  for (const [maxDays, weight] of AGE_WEIGHTS) {
    if (ageDays <= maxDays) return weight;
  }
  return OLDER_WEIGHT;
}

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

export class ComplaintHistoryService {
  constructor(private client: SupabaseClient, private radiusMeters = settings.HISTORY_RADIUS_METERS) {}

  async analyse(
    latitude: number,
    longitude: number,
    opts: { excludeId?: string; now?: Date } = {},
  ): Promise<HistoryResult> {
    const now = opts.now ?? new Date();
    const neighbours = await findNearby(this.client, latitude, longitude, this.radiusMeters, {
      excludeId: opts.excludeId,
    });

    let weighted = 0.0;
    let last7 = 0, last30 = 0, unresolved = 0, resolved = 0;

    for (const item of neighbours) {
      const complaint = item.complaint;
      const ageDays = Math.max(0, (now.getTime() - new Date(complaint.created_at).getTime()) / 86_400_000);

      if (ageDays <= 7) last7++;
      if (ageDays <= 30) last30++;

      const status = complaint.status as ComplaintStatus;
      const isOpen = !CLOSED_STATUSES.includes(status);
      if (isOpen) unresolved++;
      else if (status === "RESOLVED") resolved++;

      weighted += ageWeight(ageDays) * (isOpen ? UNRESOLVED_MULTIPLIER : RESOLVED_MULTIPLIER);
    }

    const score = round(Math.min(10.0, weighted), 2);

    return {
      score,
      totalPrevious: neighbours.length,
      last7Days: last7,
      last30Days: last30,
      unresolved,
      resolved,
      radiusMeters: this.radiusMeters,
      explanation: this.explain(neighbours.length, last7, unresolved),
    };
  }

  private explain(total: number, last7: number, unresolved: number): string {
    if (total === 0) return `No previous reports within ${this.radiusMeters}m of this location.`;

    let text = `${total} previous report${total !== 1 ? "s" : ""} within ${this.radiusMeters}m of this spot`;
    if (last7) text += `, ${last7} in the last 7 days`;
    if (unresolved) text += `, and ${unresolved} still unresolved`;
    return text + ".";
  }
}
