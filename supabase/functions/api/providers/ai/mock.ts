// Ported from backend/app/providers/ai/mock.py. NOT a trained model - derives
// a stable, plausible-looking detection set from cheap image statistics
// (dark-region ratio, blue dominance, edge density) seeded by the image
// bytes, so the same photo always yields the same analysis.
//
// The seeded-RNG algorithm itself (mulberry32, see _shared/random.ts) does
// NOT match Python's Mersenne Twister bit-for-bit - only the qualitative
// contract matters here (deterministic per image, distinguishable outputs),
// since this whole provider is an explicitly-labelled dev stub, never
// production inference.

import type { AIAnalysisProvider, AnalysisResult, Detection } from "./base.ts";
import type { DamageType } from "../../_shared/enums.ts";
import resizeImg from "npm:@jsquash/resize@2.1.1/index.js";
import { decodeAny } from "../../_shared/image_codec.ts";
import { mulberry32, seedFromBytes, uniform, weightedChoice } from "../../_shared/random.ts";

const BASE_WEIGHTS: [DamageType, number][] = [
  ["POTHOLE", 0.40],
  ["CRACKED_ROAD", 0.25],
  ["FLOODING", 0.12],
  ["DAMAGED_SIDEWALK", 0.13],
  ["BROKEN_STREETLIGHT", 0.10],
];

interface Stats {
  darkRatio: number;
  blueDominance: number;
  edgeDensity: number;
  brightness: number;
  topLightRatio: number;
}

function luminanceOf(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

async function imageStats(image: ImageData): Promise<Stats> {
  const small = await resizeImg(image, { width: 64, height: 64, method: "lanczos3", fitMethod: "stretch" });
  const { width, height, data } = small;
  const count = width * height;

  const luminance = new Float64Array(count);
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    const l = luminanceOf(data[o], data[o + 1], data[o + 2]);
    luminance[i] = l;
    sum += l;
  }
  const brightness = sum / count;

  const threshold = Math.max(20.0, brightness * 0.62);
  let darkCount = 0;
  let blueCount = 0;
  for (let i = 0; i < count; i++) {
    if (luminance[i] < threshold) darkCount++;
    const o = i * 4;
    if (data[o + 2] > data[o] + 12 && data[o + 2] > data[o + 1] + 6) blueCount++;
  }

  // 3x3 FIND_EDGES-equivalent convolution over the greyscale image
  // (kernel [-1,-1,-1, -1,8,-1, -1,-1,-1]); border pixels pass through
  // unfiltered, matching PIL's built-in 3x3 filter behaviour.
  let edgeCount = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let edgeValue: number;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        edgeValue = 0;
      } else {
        let acc = 8 * luminance[y * width + x];
        for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) {
          acc -= luminance[(y + dy) * width + (x + dx)];
        }
        edgeValue = Math.max(0, Math.min(255, acc));
      }
      if (edgeValue > 40) edgeCount++;
    }
  }
  const edgeDensity = edgeCount / count;

  const topRowCount = Math.floor(count / 2);
  let topLightCount = 0;
  for (let i = 0; i < topRowCount; i++) {
    if (luminance[i] > 125) topLightCount++;
  }
  const topLightRatio = topLightCount / Math.max(1, topRowCount);

  return { darkRatio: darkCount / count, blueDominance: blueCount / count, edgeDensity, brightness: brightness / 255, topLightRatio };
}

function chooseDamageType(stats: Stats, rng: () => number): DamageType {
  if (stats.blueDominance > 0.20) return "FLOODING";
  if (stats.brightness < 0.25) return "BROKEN_STREETLIGHT";
  if (stats.topLightRatio > 0.40) return "DAMAGED_SIDEWALK";

  const edgeToDark = stats.darkRatio / Math.max(stats.edgeDensity, 1e-6);
  if (stats.edgeDensity >= 0.125 && edgeToDark < 0.5) return "CRACKED_ROAD";
  if (stats.darkRatio > 0.005) return "POTHOLE";
  if (stats.edgeDensity > 0.085) return "CRACKED_ROAD";

  return weightedChoice(rng, BASE_WEIGHTS.map((w) => w[0]), BASE_WEIGHTS.map((w) => w[1]));
}

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

function buildDetections(primary: DamageType, stats: Stats, rng: () => number): Detection[] {
  const severityHint = Math.min(1.0, stats.darkRatio * 1.8 + stats.edgeDensity * 0.6 + stats.blueDominance * 0.75);
  const boxCount = 1 + (severityHint > 0.45 ? 1 : 0) + (severityHint > 0.75 ? 1 : 0);

  const detections: Detection[] = [];
  for (let index = 0; index < boxCount; index++) {
    const scale = 1.0 - index * 0.28;
    const width = round(Math.min(0.62, Math.max(0.06, (0.16 + severityHint * 0.34) * scale)), 4);
    const height = round(Math.min(0.55, Math.max(0.05, width * uniform(rng, 0.55, 1.05))), 4);
    detections.push({
      damageType: primary,
      confidence: round(Math.min(0.98, Math.max(0.30, uniform(rng, 0.62, 0.95) * scale + 0.08)), 4),
      bboxX: round(uniform(rng, 0.04, Math.max(0.05, 0.94 - width)), 4),
      bboxY: round(uniform(rng, 0.10, Math.max(0.11, 0.90 - height)), 4),
      bboxWidth: width,
      bboxHeight: height,
    });
  }

  if (stats.edgeDensity > 0.34 && primary !== "CRACKED_ROAD" && rng() < 0.45) {
    detections.push({
      damageType: "CRACKED_ROAD",
      confidence: round(uniform(rng, 0.48, 0.72), 4),
      bboxX: round(uniform(rng, 0.05, 0.55), 4),
      bboxY: round(uniform(rng, 0.15, 0.65), 4),
      bboxWidth: round(uniform(rng, 0.10, 0.26), 4),
      bboxHeight: round(uniform(rng, 0.06, 0.18), 4),
    });
  }

  return detections;
}

export class MockAIProvider implements AIAnalysisProvider {
  name = "mock";
  constructor(private modelName = "roadwatch-dev-stub", private modelVersion = "0.1.0") {}

  async analyze(imageBytes: Uint8Array, _contentType: string): Promise<AnalysisResult> {
    const started = performance.now();
    const decoded = await decodeAny(imageBytes);
    if (!decoded) {
      return {
        damageType: "UNKNOWN",
        confidence: 0.0,
        detections: [],
        damagedAreaRatio: 0.0,
        provider: this.name,
        modelName: this.modelName,
        modelVersion: this.modelVersion,
        processingMs: Math.round(performance.now() - started),
        errorMessage: "The uploaded file could not be read as an image.",
      };
    }

    const stats = await imageStats(decoded.image);
    const seed = await seedFromBytes(imageBytes);
    const rng = mulberry32(seed);

    const primary = chooseDamageType(stats, rng);
    const detections = buildDetections(primary, stats, rng);

    if (detections.length === 0) {
      return {
        damageType: "UNKNOWN",
        confidence: 0.0,
        detections: [],
        damagedAreaRatio: 0.0,
        provider: this.name,
        modelName: this.modelName,
        modelVersion: this.modelVersion,
        processingMs: Math.round(performance.now() - started),
      };
    }

    const best = detections.reduce((a, b) => (b.confidence > a.confidence ? b : a));
    const areaRatio = Math.min(1.0, detections.reduce((sum, d) => sum + d.bboxWidth * d.bboxHeight, 0));

    return {
      damageType: best.damageType,
      confidence: best.confidence,
      detections,
      damagedAreaRatio: round(areaRatio, 4),
      provider: this.name,
      modelName: this.modelName,
      modelVersion: this.modelVersion,
      processingMs: Math.round(performance.now() - started),
    };
  }

  async health(): Promise<boolean> {
    return true;
  }
}
