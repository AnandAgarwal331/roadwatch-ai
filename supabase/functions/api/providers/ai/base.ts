// Ported from backend/app/providers/ai/base.py.

import type { DamageType } from "../../_shared/enums.ts";

export interface Detection {
  damageType: DamageType;
  confidence: number;
  bboxX: number;
  bboxY: number;
  bboxWidth: number;
  bboxHeight: number;
}

export function detectionAreaRatio(d: Detection): number {
  return Math.max(0.0, Math.min(1.0, d.bboxWidth * d.bboxHeight));
}

export interface AnalysisResult {
  damageType: DamageType;
  confidence: number;
  detections: Detection[];
  damagedAreaRatio: number;
  modelName: string;
  modelVersion: string;
  provider: string;
  processingMs: number;
  /** Set when the provider failed; callers degrade gracefully instead of erroring. */
  errorMessage?: string;
}

export function analysisSucceeded(result: AnalysisResult): boolean {
  return result.errorMessage === undefined;
}

export interface AIAnalysisProvider {
  name: string;
  analyze(imageBytes: Uint8Array, contentType: string): Promise<AnalysisResult>;
  health(): Promise<boolean>;
}
