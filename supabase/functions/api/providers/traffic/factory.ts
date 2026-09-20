// Ported from backend/app/providers/traffic/factory.py.

import { settings } from "../../_shared/config.ts";
import type { TrafficProvider } from "./base.ts";
import { MockTrafficProvider } from "./mock.ts";
import { HttpTrafficProvider } from "./http.ts";

let cached: TrafficProvider | null = null;

export function getTrafficProvider(): TrafficProvider {
  if (cached) return cached;
  const provider = settings.TRAFFIC_PROVIDER.trim().toLowerCase();
  cached = provider === "http"
    ? new HttpTrafficProvider(settings.TRAFFIC_API_URL, settings.TRAFFIC_API_KEY)
    : new MockTrafficProvider();
  return cached;
}
