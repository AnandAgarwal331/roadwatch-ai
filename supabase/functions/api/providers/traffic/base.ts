// Ported from backend/app/providers/traffic/base.py.

import type { TrafficLevel } from "../../_shared/enums.ts";

export interface TrafficReading {
  level: TrafficLevel;
  /** 0-10, the normalised value the priority engine consumes. */
  score: number;
  estimatedVehiclesPerHour: number | null;
  observedAt: Date;
  provider: string;
}

/** Canonical mapping from a qualitative level to the 0-10 factor. */
export const LEVEL_SCORES: Record<TrafficLevel, number> = {
  LOW: 3.0,
  MEDIUM: 6.0,
  HIGH: 9.0,
  VERY_HIGH: 10.0,
};

export interface TrafficProvider {
  name: string;
  getTraffic(latitude: number, longitude: number, at: Date): Promise<TrafficReading>;
}
