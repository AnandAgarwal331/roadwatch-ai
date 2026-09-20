// Ported from backend/app/providers/places/overpass.py. Off by default (the
// public Overpass endpoint rate-limits aggressively); falls back to the
// seeded catalogue on any failure.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { NearbyPlaceResult, NearbyPlacesProvider } from "./base.ts";
import { haversineMeters } from "../../services/geo.ts";
import type { PlaceType } from "../../_shared/enums.ts";
import { SeededPlacesProvider } from "./seeded.ts";

const TAG_MAP: [string, string, PlaceType][] = [
  ["amenity", "hospital", "HOSPITAL"],
  ["amenity", "clinic", "HOSPITAL"],
  ["amenity", "school", "SCHOOL"],
  ["amenity", "college", "SCHOOL"],
  ["amenity", "fire_station", "EMERGENCY_SERVICE"],
  ["amenity", "police", "EMERGENCY_SERVICE"],
  ["highway", "bus_stop", "BUS_STOP"],
];

function classify(tags: Record<string, string>): PlaceType | null {
  for (const [key, value, placeType] of TAG_MAP) {
    if (tags[key] === value) return placeType;
  }
  return null;
}

export class OverpassPlacesProvider implements NearbyPlacesProvider {
  name = "overpass";
  private fallback: SeededPlacesProvider;

  constructor(client: SupabaseClient, private apiUrl: string, private timeoutMs = 8_000) {
    this.fallback = new SeededPlacesProvider(client);
  }

  async findNearby(latitude: number, longitude: number, radiusMeters: number): Promise<NearbyPlaceResult[]> {
    let payload: { elements?: Record<string, unknown>[] };
    try {
      payload = await this.query(latitude, longitude, radiusMeters);
    } catch {
      return await this.fallback.findNearby(latitude, longitude, radiusMeters);
    }

    const results: NearbyPlaceResult[] = [];
    for (const element of payload.elements ?? []) {
      const tags = (element.tags as Record<string, string>) ?? {};
      const placeType = classify(tags);
      if (!placeType) continue;

      const center = element.center as Record<string, unknown> | undefined;
      const lat = (element.lat as number | undefined) ?? (center?.lat as number | undefined);
      const lon = (element.lon as number | undefined) ?? (center?.lon as number | undefined);
      if (lat === undefined || lon === undefined) continue;

      const distance = haversineMeters(latitude, longitude, lat, lon);
      if (distance > radiusMeters) continue;

      results.push({
        placeType,
        name: (tags.name as string) || placeType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        latitude: lat,
        longitude: lon,
        distanceMeters: Math.round(distance * 10) / 10,
        source: this.name,
      });
    }

    results.sort((a, b) => a.distanceMeters - b.distanceMeters);
    return results;
  }

  private async query(latitude: number, longitude: number, radiusMeters: number): Promise<{ elements?: Record<string, unknown>[] }> {
    const clauses = TAG_MAP.map(
      ([key, value]) => `node(around:${radiusMeters},${latitude},${longitude})["${key}"="${value}"];`,
    ).join("");
    const timeoutSeconds = Math.floor(this.timeoutMs / 1000);
    const query = `[out:json][timeout:${timeoutSeconds}];(${clauses});out center;`;

    const response = await fetch(this.apiUrl, {
      method: "POST",
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`Overpass HTTP ${response.status}`);
    return await response.json();
  }
}
