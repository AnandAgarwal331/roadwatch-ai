import { assertEquals, assertGreater, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PriorityService, type PriorityInput } from "./priority.ts";

const WEIGHTS = { severity: 4.0, traffic: 2.5, location: 2.0, history: 1.5 };
const THRESHOLDS = { medium: 40, high: 70, critical: 85 };

function input(overrides: Partial<PriorityInput> = {}): PriorityInput {
  return { severity: 0, traffic: 0, location: 0, history: 0, ...overrides };
}

Deno.test("weights must sum to 10.0 or construction throws", () => {
  assertThrows(() => new PriorityService({ severity: 1, traffic: 1, location: 1, history: 1 }, THRESHOLDS));
});

Deno.test("all-zero factors score zero and land at LOW", () => {
  const service = new PriorityService(WEIGHTS, THRESHOLDS);
  const result = service.calculate(input());
  assertEquals(result.totalScore, 0);
  assertEquals(result.level, "LOW");
});

Deno.test("all-max factors score 100 and land at CRITICAL", () => {
  const service = new PriorityService(WEIGHTS, THRESHOLDS);
  const result = service.calculate(input({ severity: 10, traffic: 10, location: 10, history: 10 }));
  assertEquals(result.totalScore, 100);
  assertEquals(result.level, "CRITICAL");
});

Deno.test("threshold boundaries pick the level from the weighted total", () => {
  const service = new PriorityService(WEIGHTS, THRESHOLDS);
  // severity-only input keeps the math simple: score = severity * 4.0
  assertEquals(service.calculate(input({ severity: 9.99 })).level, "LOW"); // 39.96 < 40
  assertEquals(service.calculate(input({ severity: 10 })).level, "MEDIUM"); // 40.0, at the boundary
  assertEquals(service.calculate(input({ severity: 10, traffic: 10, location: 5 })).level, "HIGH"); // 75.0
  assertEquals(service.calculate(input({ severity: 10, traffic: 10, location: 10 })).level, "CRITICAL"); // 85.0
});

Deno.test("out-of-range factors are clamped into 0-10 before scoring", () => {
  const service = new PriorityService(WEIGHTS, THRESHOLDS);
  const negative = service.calculate(input({ severity: -5 }));
  const overMax = service.calculate(input({ severity: 999 }));
  assertEquals(negative.totalScore, 0);
  assertEquals(overMax.totalScore, service.calculate(input({ severity: 10 })).totalScore);
});

Deno.test("NaN factors are treated as zero, not propagated", () => {
  const service = new PriorityService(WEIGHTS, THRESHOLDS);
  const result = service.calculate(input({ severity: NaN }));
  assertEquals(result.totalScore, 0);
});

Deno.test("weather multiplier below 1.0 is floored at 1.0 (never lowers the score)", () => {
  const service = new PriorityService(WEIGHTS, THRESHOLDS);
  const base = service.calculate(input({ severity: 5 }));
  const dampened = service.calculate(input({ severity: 5, weatherMultiplier: 0.5 }));
  assertEquals(base.totalScore, dampened.totalScore);
});

Deno.test("weather multiplier above 1.0 raises the score but stays capped at 100", () => {
  const service = new PriorityService(WEIGHTS, THRESHOLDS);
  const boosted = service.calculate(input({ severity: 10, traffic: 10, location: 10, history: 10, weatherMultiplier: 1.5 }));
  assertEquals(boosted.totalScore, 100);
  const partial = service.calculate(input({ severity: 5, weatherMultiplier: 1.5 }));
  assertGreater(partial.totalScore, service.calculate(input({ severity: 5 })).totalScore);
});

Deno.test("breakdown weights and max points match the configured weights", () => {
  const service = new PriorityService(WEIGHTS, THRESHOLDS);
  const result = service.calculate(input({ severity: 5 }));
  const severityFactor = result.breakdown.find((f) => f.key === "severity")!;
  assertEquals(severityFactor.weight, 4.0);
  assertEquals(severityFactor.maxPoints, 40.0);
  assertEquals(severityFactor.points, 20.0);
});
