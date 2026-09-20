// Ported from backend/app/services/geo.py. Same two-step approach: an
// indexed bounding-box prefilter in SQL, then exact haversine refinement in
// application code over the small candidate set. No PostGIS needed.

const EARTH_RADIUS_M = 6_371_000.0;
const METERS_PER_DEGREE_LAT = 111_320.0;

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dPhi = phi2 - phi1;
  const dLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(Math.min(1.0, a)));
}

export function boundingBox(latitude: number, longitude: number, radiusMeters: number): BoundingBox {
  const latDelta = radiusMeters / METERS_PER_DEGREE_LAT;
  const cosLat = Math.max(0.01, Math.cos((latitude * Math.PI) / 180));
  const lonDelta = radiusMeters / (METERS_PER_DEGREE_LAT * cosLat);

  return {
    minLat: Math.max(-90.0, latitude - latDelta),
    maxLat: Math.min(90.0, latitude + latDelta),
    minLon: Math.max(-180.0, longitude - lonDelta),
    maxLon: Math.min(180.0, longitude + lonDelta),
  };
}

export function isValidCoordinate(latitude: number, longitude: number): boolean {
  return latitude >= -90.0 && latitude <= 90.0 && longitude >= -180.0 && longitude <= 180.0;
}
