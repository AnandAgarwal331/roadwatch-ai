import { assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseQwenReply } from "./qwen_parse.ts";

Deno.test("parses a clean reply and converts a 0-1000 box to fractions", () => {
  const r = parseQwenReply('{"damage_type":"POTHOLE","confidence":0.9,"detections":[{"damage_type":"POTHOLE","confidence":0.8,"box":[100,200,600,700]}]}')!;
  assertEquals(r.damageType, "POTHOLE");
  assertEquals(r.confidence, 0.9);
  assertEquals(r.detections.length, 1);
  assertAlmostEquals(r.detections[0].bboxX, 0.1);
  assertAlmostEquals(r.detections[0].bboxY, 0.2);
  assertAlmostEquals(r.detections[0].bboxWidth, 0.5);
  assertAlmostEquals(r.detections[0].bboxHeight, 0.5);
  assertAlmostEquals(r.damagedAreaRatio, 0.25);
});

Deno.test("copes with prose and markdown code fences around the JSON", () => {
  const r = parseQwenReply('Here is my analysis:\n```json\n{"damage_type":"cracked road","confidence":0.7,"detections":[]}\n```\nHope that helps!')!;
  assertEquals(r.damageType, "CRACKED_ROAD");
  assertEquals(r.confidence, 0.7);
});

Deno.test("accepts 0-1 fractional boxes as well", () => {
  const r = parseQwenReply('{"damage_type":"POTHOLE","confidence":0.9,"detections":[{"box":[0.1,0.1,0.4,0.5]}]}')!;
  assertAlmostEquals(r.detections[0].bboxWidth, 0.3);
  assertAlmostEquals(r.detections[0].bboxHeight, 0.4);
});

Deno.test("NONE and unrecognised types become UNKNOWN with no boxes and zero confidence", () => {
  for (const type of ["NONE", "banana"]) {
    const r = parseQwenReply(`{"damage_type":"${type}","confidence":0.95,"detections":[{"box":[0,0,500,500]}]}`)!;
    assertEquals(r.damageType, "UNKNOWN");
    assertEquals(r.confidence, 0);
    assertEquals(r.detections, []);
    assertEquals(r.damagedAreaRatio, 0);
  }
});

Deno.test("a percentage confidence is normalised", () => {
  assertEquals(parseQwenReply('{"damage_type":"POTHOLE","confidence":85,"detections":[]}')!.confidence, 0.85);
});

Deno.test("unusable boxes are dropped, not guessed: pixel-scale, inverted, wrong length", () => {
  const r = parseQwenReply(
    '{"damage_type":"POTHOLE","confidence":0.9,"detections":[{"box":[120,340,1800,2200]},{"box":[600,600,100,100]},{"box":[1,2,3]}]}',
  )!;
  assertEquals(r.detections, []);
  assertEquals(r.damageType, "POTHOLE");
});

Deno.test("overall confidence falls back to the best detection when missing", () => {
  const r = parseQwenReply('{"damage_type":"POTHOLE","detections":[{"confidence":0.6,"box":[0,0,500,500]},{"confidence":0.8,"box":[500,500,900,900]}]}')!;
  assertEquals(r.confidence, 0.8);
});

Deno.test("damaged area is capped at the whole frame", () => {
  const r = parseQwenReply('{"damage_type":"FLOODING","confidence":0.9,"detections":[{"box":[0,0,1000,1000]},{"box":[0,0,1000,1000]}]}')!;
  assertEquals(r.damagedAreaRatio, 1);
});

Deno.test("text with no JSON at all returns null", () => {
  assertEquals(parseQwenReply("I cannot help with that."), null);
  assertEquals(parseQwenReply("{not json}"), null);
});

Deno.test("ignores a <think> block, even one containing braces", () => {
  const r = parseQwenReply(
    '<think>The user wants {"damage_type": "FLOODING"} maybe, but I see a hole.</think>\n{"damage_type":"POTHOLE","confidence":0.8,"detections":[]}',
  )!;
  assertEquals(r.damageType, "POTHOLE");
});
