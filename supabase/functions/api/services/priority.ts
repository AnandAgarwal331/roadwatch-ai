// Ported from backend/app/services/priority.py. Combines four normalised
// 0-10 factors into a 0-100 explainable priority recommendation:
//   priority_score = severity*4.0 + traffic*2.5 + location*2.0 + history*1.5
// See the Python docstring for the full rationale; kept verbatim here.

import { settings } from "../_shared/config.ts";
import type { PriorityLevel } from "../_shared/enums.ts";

export const ENGINE_VERSION = "weighted-v1";

export interface PriorityWeights {
  severity: number;
  traffic: number;
  location: number;
  history: number;
}

export function weightsFromSettings(): PriorityWeights {
  return {
    severity: settings.PRIORITY_WEIGHT_SEVERITY,
    traffic: settings.PRIORITY_WEIGHT_TRAFFIC,
    location: settings.PRIORITY_WEIGHT_LOCATION,
    history: settings.PRIORITY_WEIGHT_HISTORY,
  };
}

function validateWeights(w: PriorityWeights): void {
  const total = w.severity + w.traffic + w.location + w.history;
  if (Math.abs(total - 10.0) > 1e-6) {
    throw new Error(`Priority weights must sum to 10.0 to produce a 0-100 score; got ${total}`);
  }
}

export interface PriorityThresholds {
  medium: number;
  high: number;
  critical: number;
}

export function thresholdsFromSettings(): PriorityThresholds {
  return {
    medium: settings.PRIORITY_THRESHOLD_MEDIUM,
    high: settings.PRIORITY_THRESHOLD_HIGH,
    critical: settings.PRIORITY_THRESHOLD_CRITICAL,
  };
}

function levelFor(thresholds: PriorityThresholds, score: number): PriorityLevel {
  if (score >= thresholds.critical) return "CRITICAL";
  if (score >= thresholds.high) return "HIGH";
  if (score >= thresholds.medium) return "MEDIUM";
  return "LOW";
}

export interface PriorityInput {
  severity: number;
  traffic: number;
  location: number;
  history: number;
  severityNote?: string;
  trafficNote?: string;
  locationNote?: string;
  historyNote?: string;
  /** Weather escalation, 1.0 when the signal is disabled. */
  weatherMultiplier?: number;
  signals?: Record<string, unknown>;
}

export interface FactorBreakdown {
  key: string;
  label: string;
  value: number;
  weight: number;
  points: number;
  maxPoints: number;
  note: string;
}

export interface PriorityResult {
  totalScore: number;
  level: PriorityLevel;
  explanation: string;
  breakdown: FactorBreakdown[];
  weights: PriorityWeights;
  thresholds: PriorityThresholds;
  signals: Record<string, unknown>;
  weatherMultiplier: number;
  engineVersion: string;
}

const LABELS: Record<string, string> = {
  severity: "Visual severity",
  traffic: "Traffic",
  location: "Location risk",
  history: "Complaint history",
};

function clampFactor(value: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 0.0;
  return Math.max(0.0, Math.min(10.0, value));
}

function factor(key: string, value: number, weight: number, note: string): FactorBreakdown {
  return {
    key,
    label: LABELS[key],
    value: round(value, 2),
    weight,
    points: round(value * weight, 2),
    maxPoints: round(10.0 * weight, 2),
    note,
  };
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export class PriorityService {
  weights: PriorityWeights;
  thresholds: PriorityThresholds;

  constructor(weights?: PriorityWeights, thresholds?: PriorityThresholds) {
    this.weights = weights ?? weightsFromSettings();
    this.thresholds = thresholds ?? thresholdsFromSettings();
    validateWeights(this.weights);
  }

  calculate(data: PriorityInput): PriorityResult {
    const w = this.weights;
    const severity = clampFactor(data.severity);
    const traffic = clampFactor(data.traffic);
    const location = clampFactor(data.location);
    const history = clampFactor(data.history);

    const breakdown = [
      factor("severity", severity, w.severity, data.severityNote ?? ""),
      factor("traffic", traffic, w.traffic, data.trafficNote ?? ""),
      factor("location", location, w.location, data.locationNote ?? ""),
      factor("history", history, w.history, data.historyNote ?? ""),
    ];

    const baseScore = breakdown.reduce((sum, item) => sum + item.points, 0);
    const multiplier = Math.max(1.0, data.weatherMultiplier ?? 1.0);
    const total = round(Math.min(100.0, baseScore * multiplier), 2);
    const level = levelFor(this.thresholds, total);

    return {
      totalScore: total,
      level,
      explanation: this.explain(total, level, breakdown, multiplier),
      breakdown,
      weights: { ...w },
      thresholds: { ...this.thresholds },
      signals: data.signals ?? {},
      weatherMultiplier: round(multiplier, 4),
      engineVersion: ENGINE_VERSION,
    };
  }

  private explain(total: number, level: PriorityLevel, breakdown: FactorBreakdown[], multiplier: number): string {
    const ranked = [...breakdown].sort((a, b) => b.points - a.points);
    const drivers: string[] = [];

    for (const item of ranked.slice(0, 3)) {
      if (item.points < item.maxPoints * 0.35) continue;
      const note = item.note ? item.note.replace(/\.$/, "") : fallbackNote(item);
      drivers.push(note ? note[0].toLowerCase() + note.slice(1) : note);
    }

    const headline = `${level[0]}${level.slice(1).toLowerCase()} priority (${trimNumber(total)}/100)`;
    if (drivers.length === 0) {
      return (
        `${headline}: none of the contributing factors scored highly. ` +
        "This is an AI-assisted recommendation for review by authorised personnel."
      );
    }

    const body = drivers.join("; ");
    let weather = "";
    if (multiplier > 1.0) {
      weather = ` Recent heavy rainfall raised the score by ${Math.round((multiplier - 1) * 100)}%.`;
    }

    return (
      `${headline} because ${body}.${weather} ` +
      "This is an AI-assisted recommendation; the final repair priority should be " +
      "reviewed by authorised personnel."
    );
  }
}

function fallbackNote(item: FactorBreakdown): string {
  return `${item.label.toLowerCase()} scored ${trimNumber(item.value)}/10`;
}

/** Mimics Python's `:g` format - trailing zeros/decimal point dropped. */
function trimNumber(value: number): string {
  return Number(value.toFixed(6)).toString();
}

export const priorityService = new PriorityService();
