// Ported from backend/app/providers/places/base.py.

import type { PlaceType } from "../../_shared/enums.ts";

export interface NearbyPlaceResult {
  placeType: PlaceType;
  name: string;
  latitude: number;
  longitude: number;
  distanceMeters: number;
  source: string;
}

export interface NearbyPlacesProvider {
  name: string;
  /** Facilities within radiusMeters, nearest first. */
  findNearby(latitude: number, longitude: number, radiusMeters: number): Promise<NearbyPlaceResult[]>;
}
