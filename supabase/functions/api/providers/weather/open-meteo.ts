// Real weather via Open-Meteo (https://open-meteo.com) - free for
// non-commercial use, no API key or signup required, which is what makes it
// the right default here: every other real provider in this codebase (Qwen,
// Geoapify, the TomTom-shaped traffic provider) needs a key an operator has
// to go and get, but a weather signal that only ever multiplies the score by
// up to 1.15x (see MAX_WEATHER_MULTIPLIER) doesn't justify that friction when
// a good keyless option exists.
//
// Falls back to the deterministic mock on any failure - a missing network
// path, a non-2xx response, or a malformed body - same fail-safe pattern as
// the other real providers, so scoring never blocks on a third party.

import type { WeatherProvider, WeatherReading } from "./base.ts";
import { MockWeatherProvider } from "./mock.ts";

interface OpenMeteoResponse {
  current?: { temperature_2m?: number };
  hourly?: { time?: string[]; precipitation?: number[] };
}

/** Same thresholds the mock provider uses, so `condition` means the same thing regardless of which provider produced it. */
function conditionFor(rainfallMm24h: number): string {
  if (rainfallMm24h >= 40) return "heavy_rain";
  if (rainfallMm24h >= 10) return "rain";
  if (rainfallMm24h > 0.5) return "light_rain";
  return "clear";
}

export class OpenMeteoWeatherProvider implements WeatherProvider {
  name = "open-meteo";
  private fallback = new MockWeatherProvider();

  constructor(private timeoutMs = 6_000) {}

  async getWeather(latitude: number, longitude: number, at: Date): Promise<WeatherReading> {
    let body: OpenMeteoResponse;
    try {
      body = await this.query(latitude, longitude);
    } catch {
      return await this.fallback.getWeather(latitude, longitude, at);
    }

    const temperature = body.current?.temperature_2m;
    const rainfall = sumLast24Hours(body.hourly, at);
    if (temperature === undefined || rainfall === null) {
      return await this.fallback.getWeather(latitude, longitude, at);
    }

    return {
      condition: conditionFor(rainfall),
      rainfallMm24h: Math.round(rainfall * 10) / 10,
      temperatureC: Math.round(temperature * 10) / 10,
      observedAt: at,
      provider: this.name,
    };
  }

  private async query(latitude: number, longitude: number): Promise<OpenMeteoResponse> {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", latitude.toFixed(4));
    url.searchParams.set("longitude", longitude.toFixed(4));
    url.searchParams.set("current", "temperature_2m");
    url.searchParams.set("hourly", "precipitation");
    // The last 24 hours of actuals ending at the current hour, not a
    // forecast - `past_hours` is Open-Meteo's own name for this window.
    url.searchParams.set("past_hours", "24");
    url.searchParams.set("forecast_days", "1");
    url.searchParams.set("timezone", "UTC");

    const response = await fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) });
    if (!response.ok) throw new Error(`Open-Meteo HTTP ${response.status}`);
    return (await response.json()) as OpenMeteoResponse;
  }
}

/** Sums the hourly readings whose timestamp falls in the 24 hours up to and including `at`'s hour. */
function sumLast24Hours(hourly: OpenMeteoResponse["hourly"], at: Date): number | null {
  const times = hourly?.time;
  const values = hourly?.precipitation;
  if (!times || !values || times.length === 0) return null;

  const cutoff = new Date(at);
  cutoff.setUTCMinutes(0, 0, 0);
  const windowStart = cutoff.getTime() - 23 * 3_600_000;

  let total = 0;
  let counted = 0;
  for (let i = 0; i < times.length; i++) {
    // Open-Meteo returns naive local-ish timestamps with no zone suffix;
    // `timezone=UTC` above makes that reliably parse as UTC.
    const t = new Date(`${times[i]}:00Z`).getTime();
    if (Number.isNaN(t) || t < windowStart || t > cutoff.getTime()) continue;
    total += values[i] ?? 0;
    counted++;
  }
  return counted > 0 ? total : null;
}
