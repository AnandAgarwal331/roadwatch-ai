// Ported from backend/app/services/severity.py. Turns raw detector output
// into a 0-10 visual severity estimate. See the Python docstring for the
// "what this is / is not" rationale - kept verbatim there, not repeated here.

import type { DamageType } from "../_shared/enums.ts";
import { analysisSucceeded, type AnalysisResult } from "../providers/ai/base.ts";

const DEFAULT_BASE_SEVERITY: Record<DamageType, number> = {
  FLOODING: 6.0,
  POTHOLE: 5.5,
  DAMAGED_SIDEWALK: 4.5,
  BROKEN_STREETLIGHT: 4.0,
  CRACKED_ROAD: 3.5,
  OTHER: 3.0,
  UNKNOWN: 2.5,
};

export interface SeverityConfig {
  baseSeverity: Record<DamageType, number>;
  /** Area coverage (0-1) -> points added, read as upper-bound bands. */
  areaBands: [number, number][];
  pointsPerExtraDetection: number;
  maxDetectionBonus: number;
  confidenceFloor: number;
  maxConfidencePenalty: number;
  minSeverity: number;
  maxSeverity: number;
}

export function defaultSeverityConfig(): SeverityConfig {
  return {
    baseSeverity: { ...DEFAULT_BASE_SEVERITY },
    areaBands: [
      [0.02, 0.0],
      [0.06, 0.8],
      [0.12, 1.6],
      [0.22, 2.4],
      [0.35, 3.2],
      [1.01, 4.0],
    ],
    pointsPerExtraDetection: 0.6,
    maxDetectionBonus: 1.8,
    confidenceFloor: 0.45,
    maxConfidencePenalty: 2.0,
    minSeverity: 1.0,
    maxSeverity: 10.0,
  };
}

export interface SeverityResult {
  score: number;
  explanation: string;
  components: { base: number; area: number; count: number; confidence: number };
}

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

export class SeverityService {
  config: SeverityConfig;

  constructor(config?: SeverityConfig) {
    this.config = config ?? defaultSeverityConfig();
  }

  estimate(analysis: AnalysisResult): SeverityResult {
    const cfg = this.config;

    if (!analysisSucceeded(analysis) || analysis.detections.length === 0) {
      return {
        score: 0.0,
        explanation: "No damage could be visually assessed from the photo.",
        components: { base: 0.0, area: 0.0, count: 0.0, confidence: 0.0 },
      };
    }

    const base = cfg.baseSeverity[analysis.damageType] ?? cfg.baseSeverity.UNKNOWN;
    const areaPoints = this.areaPoints(analysis.damagedAreaRatio);
    const countPoints = Math.min(
      cfg.maxDetectionBonus,
      Math.max(0, analysis.detections.length - 1) * cfg.pointsPerExtraDetection,
    );
    const confidencePenalty = this.confidencePenalty(analysis.confidence);

    const raw = base + areaPoints + countPoints - confidencePenalty;
    const score = round(Math.max(cfg.minSeverity, Math.min(cfg.maxSeverity, raw)), 1);

    return {
      score,
      explanation: this.explain(analysis, base, areaPoints, countPoints, confidencePenalty),
      components: {
        base: round(base, 2),
        area: round(areaPoints, 2),
        count: round(countPoints, 2),
        confidence: round(-confidencePenalty, 2),
      },
    };
  }

  private areaPoints(areaRatio: number): number {
    const ratio = Math.max(0.0, Math.min(1.0, areaRatio));
    for (const [upperBound, points] of this.config.areaBands) {
      if (ratio < upperBound) return points;
    }
    return this.config.areaBands[this.config.areaBands.length - 1][1];
  }

  private confidencePenalty(confidence: number): number {
    const cfg = this.config;
    if (confidence >= cfg.confidenceFloor || cfg.confidenceFloor <= 0) return 0.0;
    const shortfall = (cfg.confidenceFloor - confidence) / cfg.confidenceFloor;
    return round(shortfall * cfg.maxConfidencePenalty, 3);
  }

  private explain(
    analysis: AnalysisResult,
    base: number,
    areaPoints: number,
    countPoints: number,
    confidencePenalty: number,
  ): string {
    const label = analysis.damageType.replace(/_/g, " ").toLowerCase();
    const parts = [`${label} has a baseline visual severity of ${trimNumber(base)}/10`];

    const percent = analysis.damagedAreaRatio * 100;
    if (areaPoints > 0) {
      parts.push(`the damage covers about ${percent.toFixed(0)}% of the frame (+${trimNumber(areaPoints)})`);
    } else {
      parts.push(`the damaged area is small, about ${percent.toFixed(0)}% of the frame`);
    }

    if (countPoints > 0) {
      parts.push(`${analysis.detections.length} separate damaged regions were found (+${trimNumber(countPoints)})`);
    }

    if (confidencePenalty > 0) {
      parts.push(
        `detection confidence is low at ${(analysis.confidence * 100).toFixed(0)}%, ` +
          `so the estimate is held back (-${trimNumber(confidencePenalty)})`,
      );
    }

    return (
      "Visual severity estimate: " +
      parts.join(", ") +
      ". This is an AI-assisted assessment of the photograph, not an engineering inspection."
    );
  }
}

function trimNumber(value: number): string {
  return Number(value.toFixed(6)).toString();
}

export const severityService = new SeverityService();
