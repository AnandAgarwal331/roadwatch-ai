// Ported from backend/app/providers/traffic/http.py. Falls back to the
// development provider on any failure so scoring never blocks on a third
// party.

import type { TrafficProvider, TrafficReading } from "./base.ts";
import { LEVEL_SCORES } from "./base.ts";
import type { TrafficLevel } from "../../_shared/enums.ts";
import { MockTrafficProvider } from "./mock.ts";

function toLevel(currentSpeed: number, freeFlowSpeed: number): TrafficLevel {
  if (freeFlowSpeed <= 0) return "MEDIUM";
  const ratio = Math.max(0.0, Math.min(1.0, currentSpeed / freeFlowSpeed));
  if (ratio >= 0.85) return "LOW";
  if (ratio >= 0.60) return "MEDIUM";
  if (ratio >= 0.35) return "HIGH";
  return "VERY_HIGH";
}

export class HttpTrafficProvider implements TrafficProvider {
  name = "http";
  private fallback = new MockTrafficProvider();

  constructor(private apiUrl: string, private apiKey: string, private timeoutMs = 6_000) {}

  async getTraffic(latitude: number, longitude: number, at: Date): Promise<TrafficReading> {
    if (!this.apiUrl || !this.apiKey) {
      return await this.fallback.getTraffic(latitude, longitude, at);
    }

    const url = new URL(this.apiUrl);
    url.searchParams.set("point", `${latitude},${longitude}`);
    url.searchParams.set("key", this.apiKey);
    url.searchParams.set("unit", "KMPH");

    let data: Record<string, unknown>;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      data = await response.json();
    } catch {
      return await this.fallback.getTraffic(latitude, longitude, at);
    }

    const segment = (data.flowSegmentData as Record<string, unknown>) ?? data;
    const current = Number(segment.currentSpeed ?? 0);
    const freeFlow = Number(segment.freeFlowSpeed ?? 0);
    const level = toLevel(current, freeFlow);

    return {
      level,
      score: LEVEL_SCORES[level],
      estimatedVehiclesPerHour: null,
      observedAt: at,
      provider: this.name,
    };
  }
}
