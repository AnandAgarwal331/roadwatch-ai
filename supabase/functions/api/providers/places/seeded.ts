// Ported from backend/app/providers/places/seeded.py. Backed by the
// seeded_places table - real data flow through the real database, only the
// *source* of the catalogue is local rather than a live map API.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { NearbyPlaceResult, NearbyPlacesProvider } from "./base.ts";
import { boundingBox, haversineMeters } from "../../services/geo.ts";
import type { PlaceType } from "../../_shared/enums.ts";

export class SeededPlacesProvider implements NearbyPlacesProvider {
  name = "seeded";
  constructor(private client: SupabaseClient) {}

  async findNearby(latitude: number, longitude: number, radiusMeters: number): Promise<NearbyPlaceResult[]> {
    const box = boundingBox(latitude, longitude, radiusMeters);
    const { data, error } = await this.client
      .from("seeded_places")
      .select("place_type, name, latitude, longitude")
      .gte("latitude", box.minLat)
      .lte("latitude", box.maxLat)
      .gte("longitude", box.minLon)
      .lte("longitude", box.maxLon);
    if (error) throw error;

    const results: NearbyPlaceResult[] = [];
    for (const place of data ?? []) {
      const distance = haversineMeters(latitude, longitude, place.latitude, place.longitude);
      if (distance <= radiusMeters) {
        results.push({
          placeType: place.place_type as PlaceType,
          name: place.name,
          latitude: place.latitude,
          longitude: place.longitude,
          distanceMeters: Math.round(distance * 10) / 10,
          source: this.name,
        });
      }
    }

    results.sort((a, b) => a.distanceMeters - b.distanceMeters);
    return results;
  }
}
