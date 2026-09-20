// Ported from backend/app/providers/places/factory.py. Not cached (like the
// Python version) - the seeded provider is bound to a request-scoped client.

import type { SupabaseClient } from "@supabase/supabase-js";
import { settings } from "../../_shared/config.ts";
import type { NearbyPlacesProvider } from "./base.ts";
import { SeededPlacesProvider } from "./seeded.ts";
import { OverpassPlacesProvider } from "./overpass.ts";

export function getPlacesProvider(client: SupabaseClient): NearbyPlacesProvider {
  const provider = settings.PLACES_PROVIDER.trim().toLowerCase();
  if (provider === "overpass") {
    return new OverpassPlacesProvider(client, settings.PLACES_API_URL);
  }
  return new SeededPlacesProvider(client);
}
