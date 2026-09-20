// Ported from backend/app/services/location_risk.py. Converts "what is near
// this pothole" into the 0-10 location factor the priority engine consumes.
// See the Python docstring for the scoring rationale.

import type { PlaceType } from "../_shared/enums.ts";
import type { NearbyPlaceResult } from "../providers/places/base.ts";

const DEFAULT_PLACE_WEIGHTS: Partial<Record<PlaceType, number>> = {
  HOSPITAL: 10.0,
  EMERGENCY_SERVICE: 9.5,
  SCHOOL: 8.5,
  MAJOR_INTERSECTION: 7.5,
  BUS_STOP: 6.5,
};

export interface LocationRiskConfig {
  placeWeights: Partial<Record<PlaceType, number>>;
  /** Retained weight at the edge of the search radius (1.0 at zero distance). */
  edgeRetention: number;
  /** Bonus per additional distinct critical facility type nearby. */
  diversityBonus: number;
  maxDiversityBonus: number;
  /** Fraction of road importance used as a floor when nothing is nearby. */
  roadImportanceFloorRatio: number;
}

export function defaultLocationRiskConfig(): LocationRiskConfig {
  return {
    placeWeights: { ...DEFAULT_PLACE_WEIGHTS },
    edgeRetention: 0.4,
    diversityBonus: 0.4,
    maxDiversityBonus: 1.2,
    roadImportanceFloorRatio: 0.35,
  };
}

export interface LocationRiskResult {
  score: number;
  explanation: string;
  /** Closest distance per facility type, for the UI. */
  nearestByType: Record<string, number>;
  placeCount: number;
}

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

export class LocationRiskService {
  config: LocationRiskConfig;

  constructor(config?: LocationRiskConfig) {
    this.config = config ?? defaultLocationRiskConfig();
  }

  assess(places: NearbyPlaceResult[], radiusMeters: number, roadImportance = 5.0): LocationRiskResult {
    const cfg = this.config;
    const roadFloor = roadImportance * cfg.roadImportanceFloorRatio;

    if (places.length === 0) {
      return {
        score: round(Math.max(0.0, Math.min(10.0, roadFloor)), 2),
        explanation:
          "No hospitals, schools, bus stops or emergency services were found within " +
          `${radiusMeters}m. The score reflects the road's own importance.`,
        nearestByType: {},
        placeCount: 0,
      };
    }

    const nearestByType: Record<string, number> = {};
    let bestScore = 0.0;
    let bestPlace: NearbyPlaceResult | null = null;

    for (const place of places) {
      const key = place.placeType;
      if (!(key in nearestByType) || place.distanceMeters < nearestByType[key]) {
        nearestByType[key] = round(place.distanceMeters, 1);
      }

      const weight = cfg.placeWeights[place.placeType] ?? 5.0;
      const weighted = weight * this.decay(place.distanceMeters, radiusMeters);
      if (weighted > bestScore) {
        bestScore = weighted;
        bestPlace = place;
      }
    }

    const distinctTypes = Object.keys(nearestByType).length;
    const diversity = Math.min(cfg.maxDiversityBonus, Math.max(0, distinctTypes - 1) * cfg.diversityBonus);

    const score = round(Math.max(0.0, Math.min(10.0, Math.max(bestScore + diversity, roadFloor))), 2);

    return {
      score,
      explanation: this.explain(bestPlace, distinctTypes, radiusMeters, places.length),
      nearestByType,
      placeCount: places.length,
    };
  }

  private decay(distanceMeters: number, radiusMeters: number): number {
    if (radiusMeters <= 0) return 1.0;
    const ratio = Math.max(0.0, Math.min(1.0, distanceMeters / radiusMeters));
    return 1.0 - (1.0 - this.config.edgeRetention) * ratio;
  }

  private explain(
    bestPlace: NearbyPlaceResult | null,
    distinctTypes: number,
    radiusMeters: number,
    totalPlaces: number,
  ): string {
    if (bestPlace === null) return "No nearby critical facilities were found.";

    const label = bestPlace.placeType.replace(/_/g, " ").toLowerCase();
    let text =
      `The most sensitive facility nearby is a ${label} ` +
      `(${bestPlace.name}) about ${bestPlace.distanceMeters.toFixed(0)}m away`;
    if (distinctTypes > 1) {
      text += `, and ${totalPlaces} facilities of ${distinctTypes} different kinds sit within ${radiusMeters}m`;
    }
    return text + ".";
  }
}

export const locationRiskService = new LocationRiskService();
