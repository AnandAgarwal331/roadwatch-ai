// Real-world nearby-places data via Geoapify's Places API (a paid service
// with a free-tier key - see https://www.geoapify.com/places-api/), added
// because the public OpenStreetMap Overpass endpoint (see overpass.ts)
// blocks automated requests from both this project's own network tests and
// from Supabase's Edge Function network, so it never returns real results in
// practice. Falls back to the seeded catalogue on any failure - a missing
// key, a network error, a non-2xx response, or an empty API key setting -
// same fail-safe pattern as the Overpass provider.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { NearbyPlaceResult, NearbyPlacesProvider } from "./base.ts";
import { haversineMeters } from "../../services/geo.ts";
import type { PlaceType } from "../../_shared/enums.ts";
import { SeededPlacesProvider } from "./seeded.ts";

// Ordered so the first matching category wins when a place carries more than
// one (e.g. a feature tagged both "healthcare" and "healthcare.hospital").
const CATEGORY_MAP: [string, PlaceType][] = [
  ["healthcare.hospital", "HOSPITAL"],
  ["healthcare.clinic_or_praxis", "HOSPITAL"],
  ["service.police", "EMERGENCY_SERVICE"],
  ["service.fire_station", "EMERGENCY_SERVICE"],
  ["education.school", "SCHOOL"],
  ["education.college", "SCHOOL"],
  ["education.university", "SCHOOL"],
  ["public_transport.bus", "BUS_STOP"],
];
const REQUESTED_CATEGORIES = CATEGORY_MAP.map(([category]) => category).join(",");

function classify(categories: string[]): PlaceType | null {
  for (const [category, placeType] of CATEGORY_MAP) {
    if (categories.includes(category)) return placeType;
  }
  return null;
}

interface GeoapifyFeature {
  properties?: {
    categories?: string[];
    name?: string;
    lat?: number;
    lon?: number;
  };
  geometry?: { coordinates?: [number, number] };
}

export class GeoapifyPlacesProvider implements NearbyPlacesProvider {
  name = "geoapify";
  private fallback: SeededPlacesProvider;

  constructor(client: SupabaseClient, private apiKey: string, private timeoutMs = 8_000) {
    this.fallback = new SeededPlacesProvider(client);
  }

  async findNearby(latitude: number, longitude: number, radiusMeters: number): Promise<NearbyPlaceResult[]> {
    if (!this.apiKey) {
      return await this.fallback.findNearby(latitude, longitude, radiusMeters);
    }

    let features: GeoapifyFeature[];
    try {
      features = await this.query(latitude, longitude, radiusMeters);
    } catch {
      return await this.fallback.findNearby(latitude, longitude, radiusMeters);
    }

    const results: NearbyPlaceResult[] = [];
    for (const feature of features) {
      const props = feature.properties ?? {};
      const placeType = classify(props.categories ?? []);
      if (!placeType) continue;

      const lat = props.lat ?? feature.geometry?.coordinates?.[1];
      const lon = props.lon ?? feature.geometry?.coordinates?.[0];
      if (lat === undefined || lon === undefined) continue;

      const distance = haversineMeters(latitude, longitude, lat, lon);
      if (distance > radiusMeters) continue;

      results.push({
        placeType,
        name: props.name || placeType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        latitude: lat,
        longitude: lon,
        distanceMeters: Math.round(distance * 10) / 10,
        source: this.name,
      });
    }

    results.sort((a, b) => a.distanceMeters - b.distanceMeters);
    return results;
  }

  private async query(latitude: number, longitude: number, radiusMeters: number): Promise<GeoapifyFeature[]> {
    const url = new URL("https://api.geoapify.com/v2/places");
    url.searchParams.set("categories", REQUESTED_CATEGORIES);
    url.searchParams.set("filter", `circle:${longitude},${latitude},${radiusMeters}`);
    url.searchParams.set("limit", "50");
    url.searchParams.set("apiKey", this.apiKey);

    const response = await fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) });
    if (!response.ok) throw new Error(`Geoapify HTTP ${response.status}`);
    const body = (await response.json()) as { features?: GeoapifyFeature[] };
    return body.features ?? [];
  }
}
