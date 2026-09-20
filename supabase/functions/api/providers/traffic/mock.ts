// Ported from backend/app/providers/traffic/mock.py. Deterministic in
// location and time via SHA-256 of a grid cell - same algorithm as Python
// (Web Crypto's SHA-256 is bit-identical to hashlib's), so this one DOES
// reproduce the Python output exactly, unlike the AI mock's random detections.

import type { TrafficProvider, TrafficReading } from "./base.ts";
import { LEVEL_SCORES } from "./base.ts";
import type { TrafficLevel } from "../../_shared/enums.ts";

const GRID = 0.001;

async function corridorWeight(latitude: number, longitude: number): Promise<number> {
  const cell = `${Math.round(latitude / GRID)}:${Math.round(longitude / GRID)}`;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(cell)));
  const first4 = (digest[0] << 24) | (digest[1] << 16) | (digest[2] << 8) | digest[3];
  return (first4 >>> 0) / 0xffffffff;
}

function timeMultiplier(at: Date): number {
  const hour = at.getUTCHours();
  if ((hour >= 8 && hour <= 11) || (hour >= 17 && hour <= 20)) return 1.28; // peak
  if (hour >= 0 && hour <= 5) return 0.55; // overnight
  if (hour >= 12 && hour <= 16) return 1.0;
  return 0.85;
}

export class MockTrafficProvider implements TrafficProvider {
  name = "mock";

  async getTraffic(latitude: number, longitude: number, at: Date): Promise<TrafficReading> {
    const base = await corridorWeight(latitude, longitude);
    const intensity = Math.min(1.0, base * timeMultiplier(at));

    let level: TrafficLevel;
    if (intensity < 0.30) level = "LOW";
    else if (intensity < 0.58) level = "MEDIUM";
    else if (intensity < 0.84) level = "HIGH";
    else level = "VERY_HIGH";

    return {
      level,
      score: LEVEL_SCORES[level],
      estimatedVehiclesPerHour: Math.round(200 + intensity * 2600),
      observedAt: at,
      provider: this.name,
    };
  }
}
