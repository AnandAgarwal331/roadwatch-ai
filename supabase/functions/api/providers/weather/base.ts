// Ported from backend/app/providers/weather/base.py.

import type { DamageType } from "../../_shared/enums.ts";

const WEATHER_SENSITIVE_TYPES: DamageType[] = ["FLOODING", "POTHOLE", "CRACKED_ROAD"];

/** Hard ceiling on the escalation, so weather can never dominate the score. */
export const MAX_WEATHER_MULTIPLIER = 1.15;

export interface WeatherReading {
  condition: string;
  rainfallMm24h: number;
  temperatureC: number | null;
  observedAt: Date;
  provider: string;
}

export function riskMultiplier(reading: WeatherReading, damageType: DamageType): number {
  if (!WEATHER_SENSITIVE_TYPES.includes(damageType) || reading.rainfallMm24h <= 5) return 1.0;
  const ramp = Math.min(1.0, (reading.rainfallMm24h - 5) / 55);
  return Math.round((1.0 + ramp * (MAX_WEATHER_MULTIPLIER - 1.0)) * 10000) / 10000;
}

export interface WeatherProvider {
  name: string;
  getWeather(latitude: number, longitude: number, at: Date): Promise<WeatherReading>;
}
