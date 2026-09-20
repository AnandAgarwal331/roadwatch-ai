// Ported from backend/app/providers/weather/mock.py. Deterministic via
// SHA-256 (same algorithm as Python's hashlib), so this reproduces the
// Python output bit-for-bit, same as the traffic mock.

import type { WeatherProvider, WeatherReading } from "./base.ts";

const MONTH_WETNESS = [0.05, 0.05, 0.08, 0.12, 0.25, 0.75, 0.95, 0.90, 0.70, 0.35, 0.15, 0.08];

export class MockWeatherProvider implements WeatherProvider {
  name = "mock";

  async getWeather(latitude: number, longitude: number, at: Date): Promise<WeatherReading> {
    const dateIso = at.toISOString().slice(0, 10);
    const key = `${round(latitude, 2)}:${round(longitude, 2)}:${dateIso}`;
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)));
    const first4 = ((digest[0] << 24) | (digest[1] << 16) | (digest[2] << 8) | digest[3]) >>> 0;
    const roll = first4 / 0xffffffff;

    const wetness = MONTH_WETNESS[at.getUTCMonth()];
    const rainfall = round(roll * wetness * 85.0, 1);

    let condition: string;
    if (rainfall >= 40) condition = "heavy_rain";
    else if (rainfall >= 10) condition = "rain";
    else if (rainfall > 0.5) condition = "light_rain";
    else condition = "clear";

    const temperature = round(22.0 + (1 - wetness) * 12.0 + (roll - 0.5) * 4, 1);

    return {
      condition,
      rainfallMm24h: rainfall,
      temperatureC: temperature,
      observedAt: at,
      provider: this.name,
    };
  }
}

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}
