// Ported from backend/app/providers/weather/factory.py.

import { settings } from "../../_shared/config.ts";
import type { WeatherProvider } from "./base.ts";
import { MockWeatherProvider } from "./mock.ts";

let cached: WeatherProvider | null | undefined;

/** null when the weather signal is switched off. */
export function getWeatherProvider(): WeatherProvider | null {
  if (cached !== undefined) return cached;
  cached = settings.WEATHER_ENABLED ? new MockWeatherProvider() : null;
  return cached;
}
