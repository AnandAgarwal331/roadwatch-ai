// Ported from backend/app/providers/weather/factory.py.

import { settings } from "../../_shared/config.ts";
import type { WeatherProvider } from "./base.ts";
import { MockWeatherProvider } from "./mock.ts";
import { OpenMeteoWeatherProvider } from "./open-meteo.ts";

let cached: WeatherProvider | null | undefined;

/** null when the weather signal is switched off. */
export function getWeatherProvider(): WeatherProvider | null {
  if (cached !== undefined) return cached;
  if (!settings.WEATHER_ENABLED) {
    cached = null;
  } else {
    // "open-meteo" (a real, free, keyless forecast) or "mock" (deterministic
    // dev stub) - see providers/weather/open-meteo.ts for why that's the
    // real option rather than something that needs a paid key.
    cached = settings.WEATHER_PROVIDER.trim().toLowerCase() === "open-meteo"
      ? new OpenMeteoWeatherProvider()
      : new MockWeatherProvider();
  }
  return cached;
}
