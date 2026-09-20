// Turns a vision-language model's text reply into the app's AnalysisResult
// fields. Kept pure so the fragile part - models wrap JSON in prose or code
// fences, and report box coordinates in different scales - is unit tested
// without any network call.
//
// The prompt (see qwen.ts) asks for boxes as [x1, y1, x2, y2] on a 0-1000
// grid; this also accepts 0-1 fractions, since some models ignore that
// instruction. Anything else (raw pixels, which would need the image size to
// interpret) is dropped rather than guessed at.

import type { Detection } from "./base.ts";
import type { DamageType } from "../../_shared/enums.ts";

const VALID: DamageType[] = ["POTHOLE", "CRACKED_ROAD", "FLOODING", "DAMAGED_SIDEWALK", "BROKEN_STREETLIGHT", "OTHER"];
const MAX_DETECTIONS = 10;

export interface ParsedReply {
  damageType: DamageType;
  confidence: number;
  detections: Detection[];
  damagedAreaRatio: number;
}

function toDamageType(value: unknown): DamageType {
  const upper = String(value ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  return (VALID as string[]).includes(upper) ? (upper as DamageType) : "UNKNOWN";
}

function toConfidence(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  // Some models answer "85" meaning 85%.
  return Math.min(1, n > 1 ? n / 100 : n);
}

function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

function toBox(raw: unknown): { x: number; y: number; w: number; h: number } | null {
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  const nums = raw.map(Number);
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;

  const largest = Math.max(...nums);
  const scale = largest <= 1.0001 ? 1 : largest <= 1000 ? 1000 : null;
  if (scale === null) return null;

  const [x1, y1, x2, y2] = nums.map((n) => Math.min(1, n / scale));
  if (x2 <= x1 || y2 <= y1) return null;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Returns null when the reply contains no usable JSON object at all. */
export function parseQwenReply(text: string): ParsedReply | null {
  const root = extractJson(text) as Record<string, unknown> | null;
  if (!root || typeof root !== "object") return null;

  const damageType = toDamageType(root.damage_type);
  const overall = toConfidence(root.confidence);

  const detections: Detection[] = [];
  const rawList = Array.isArray(root.detections) ? root.detections : [];
  for (const item of rawList.slice(0, MAX_DETECTIONS)) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const box = toBox(entry.box ?? entry.bbox);
    if (!box) continue;
    const type = toDamageType(entry.damage_type ?? root.damage_type);
    if (type === "UNKNOWN") continue;
    detections.push({
      damageType: type,
      confidence: toConfidence(entry.confidence) ?? overall ?? 0.5,
      bboxX: box.x,
      bboxY: box.y,
      bboxWidth: box.w,
      bboxHeight: box.h,
    });
  }

  const confidence =
    damageType === "UNKNOWN" ? 0 : (overall ?? (detections.length ? Math.max(...detections.map((d) => d.confidence)) : 0.5));

  // Boxes may overlap, so this is an upper bound on the damaged share of the frame.
  const damagedAreaRatio =
    damageType === "UNKNOWN" ? 0 : Math.min(1, detections.reduce((sum, d) => sum + d.bboxWidth * d.bboxHeight, 0));

  return { damageType, confidence, detections: damageType === "UNKNOWN" ? [] : detections, damagedAreaRatio };
}
