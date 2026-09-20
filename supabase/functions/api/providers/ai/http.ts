// Ported from backend/app/providers/ai/http.py. Talks to the standalone
// ai-service over HTTP; every failure mode degrades to an AnalysisResult
// with errorMessage set - a detector outage must never cost a citizen their
// report.

import type { AIAnalysisProvider, AnalysisResult, Detection } from "./base.ts";
import type { DamageType } from "../../_shared/enums.ts";

const VALID_DAMAGE_TYPES: DamageType[] = [
  "POTHOLE", "CRACKED_ROAD", "FLOODING", "DAMAGED_SIDEWALK", "BROKEN_STREETLIGHT", "OTHER", "UNKNOWN",
];

function coerceDamageType(value: unknown): DamageType {
  const upper = String(value ?? "").toUpperCase();
  return (VALID_DAMAGE_TYPES as string[]).includes(upper) ? (upper as DamageType) : "UNKNOWN";
}

export class HttpAIProvider implements AIAnalysisProvider {
  name = "http";
  constructor(private baseUrl: string, private timeoutMs = 20_000) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async analyze(imageBytes: Uint8Array, contentType: string): Promise<AnalysisResult> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(imageBytes)], { type: contentType || "application/octet-stream" }), "upload");

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/analyze`, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        return this.failure("The AI service took too long to respond.");
      }
      return this.failure("The AI service is unreachable.");
    }

    if (!response.ok) {
      return this.failure("The AI service rejected the image.");
    }

    let payload: Record<string, unknown>;
    try {
      payload = await response.json();
    } catch {
      return this.failure("The AI service returned an unreadable response.");
    }

    return this.parse(payload);
  }

  async health(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(3_000) });
      return response.status === 200;
    } catch {
      return false;
    }
  }

  private failure(message: string): AnalysisResult {
    return {
      damageType: "UNKNOWN",
      confidence: 0.0,
      detections: [],
      damagedAreaRatio: 0.0,
      modelName: "unknown",
      modelVersion: "0",
      provider: this.name,
      processingMs: 0,
      errorMessage: message,
    };
  }

  private parse(payload: Record<string, unknown>): AnalysisResult {
    const rawDetections = Array.isArray(payload.detections) ? payload.detections : [];
    const detections: Detection[] = rawDetections.map((item: Record<string, unknown>) => ({
      damageType: coerceDamageType(item.damage_type),
      confidence: Number(item.confidence ?? 0),
      bboxX: Number(item.bbox_x ?? 0),
      bboxY: Number(item.bbox_y ?? 0),
      bboxWidth: Number(item.bbox_width ?? 0),
      bboxHeight: Number(item.bbox_height ?? 0),
    }));

    return {
      damageType: coerceDamageType(payload.damage_type),
      confidence: Number(payload.confidence ?? 0),
      detections,
      damagedAreaRatio: Number(payload.damaged_area_ratio ?? 0),
      modelName: String(payload.model_name ?? "unknown"),
      modelVersion: String(payload.model_version ?? "0"),
      provider: this.name,
      processingMs: Number(payload.processing_ms ?? 0),
    };
  }
}
