import { assertEquals, assertGreater } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { SeverityService } from "./severity.ts";
import type { AnalysisResult, Detection } from "../providers/ai/base.ts";

function detection(overrides: Partial<Detection> = {}): Detection {
  return {
    damageType: "POTHOLE",
    confidence: 0.9,
    bboxX: 0.1,
    bboxY: 0.1,
    bboxWidth: 0.1,
    bboxHeight: 0.1,
    ...overrides,
  };
}

function analysis(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    damageType: "POTHOLE",
    confidence: 0.9,
    detections: [detection()],
    damagedAreaRatio: 0.01,
    modelName: "test-model",
    modelVersion: "1",
    provider: "mock",
    processingMs: 1,
    ...overrides,
  };
}

const service = new SeverityService();

Deno.test("no detections scores zero regardless of damage type", () => {
  const result = service.estimate(analysis({ detections: [], damagedAreaRatio: 0 }));
  assertEquals(result.score, 0.0);
});

Deno.test("a provider error scores zero even if a stale damage type is set", () => {
  const result = service.estimate(analysis({ errorMessage: "provider timed out" }));
  assertEquals(result.score, 0.0);
});

Deno.test("score always stays within the configured 1-10 band", () => {
  const low = service.estimate(analysis({ damageType: "UNKNOWN", damagedAreaRatio: 0, confidence: 0.01 }));
  const high = service.estimate(
    analysis({
      damageType: "FLOODING",
      damagedAreaRatio: 1,
      confidence: 1,
      detections: Array.from({ length: 10 }, () => detection()),
    }),
  );
  assertGreater(low.score, 0.99); // clamped to minSeverity, not down to 0
  assertEquals(high.score, 10.0); // clamped to maxSeverity
});

Deno.test("a larger damaged area scores at least as high as a smaller one, all else equal", () => {
  const small = service.estimate(analysis({ damagedAreaRatio: 0.01 }));
  const large = service.estimate(analysis({ damagedAreaRatio: 0.5 }));
  assertGreater(large.score, small.score);
});

Deno.test("more detections of the same damage raise the score, up to the configured cap", () => {
  const one = service.estimate(analysis({ detections: [detection()] }));
  const many = service.estimate(analysis({ detections: Array.from({ length: 5 }, () => detection()) }));
  assertGreater(many.score, one.score);
});

Deno.test("low confidence below the floor pulls the score down", () => {
  const confident = service.estimate(analysis({ confidence: 0.9 }));
  const unsure = service.estimate(analysis({ confidence: 0.1 }));
  assertGreater(confident.score, unsure.score);
});

Deno.test("an unrecognised damage type falls back to the UNKNOWN baseline", () => {
  // deno-lint-ignore no-explicit-any
  const result = service.estimate(analysis({ damageType: "NOT_A_REAL_TYPE" as any, damagedAreaRatio: 0 }));
  assertEquals(result.components.base, 2.5); // DEFAULT_BASE_SEVERITY.UNKNOWN
});
