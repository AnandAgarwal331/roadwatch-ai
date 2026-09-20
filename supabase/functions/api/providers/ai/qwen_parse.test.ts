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

Deno.test("0-1000 boxes are normalised by the longer side of the image (measured on a real photo)", () => {
  // Portrait 323x485 photo; Qwen returned [214,207,401,783] for a hole that
  // truly spans x 0.33-0.62, y 0.21-0.77.
  const portrait = parseQwenReply('{"damage_type":"POTHOLE","confidence":0.9,"detections":[{"box":[214,207,401,783]}]}', { width: 323, height: 485 })!;
  assertAlmostEquals(portrait.detections[0].bboxX, 0.32, 0.01);
  assertAlmostEquals(portrait.detections[0].bboxY, 0.207, 0.01);
  assertAlmostEquals(portrait.detections[0].bboxX + portrait.detections[0].bboxWidth, 0.60, 0.01);
  assertAlmostEquals(portrait.detections[0].bboxY + portrait.detections[0].bboxHeight, 0.783, 0.01);

  // Landscape 485x323 photo; vertical values scale by 485/323.
  const landscape = parseQwenReply('{"damage_type":"POTHOLE","confidence":0.9,"detections":[{"box":[170,205,790,385]}]}', { width: 485, height: 323 })!;
  assertAlmostEquals(landscape.detections[0].bboxY, 0.308, 0.01);
  assertAlmostEquals(landscape.detections[0].bboxY + landscape.detections[0].bboxHeight, 0.578, 0.01);
  assertAlmostEquals(landscape.detections[0].bboxX, 0.17, 0.01);
});

Deno.test("a square image is unaffected by the longer-side rule", () => {
  const r = parseQwenReply('{"damage_type":"POTHOLE","confidence":0.9,"detections":[{"box":[100,200,600,700]}]}', { width: 800, height: 800 })!;
  assertAlmostEquals(r.detections[0].bboxY, 0.2);
  assertAlmostEquals(r.detections[0].bboxWidth, 0.5);
});

Deno.test("fractional 0-1 boxes are never rescaled, even with a known size", () => {
  const r = parseQwenReply('{"damage_type":"POTHOLE","confidence":0.9,"detections":[{"box":[0.1,0.1,0.4,0.5]}]}', { width: 485, height: 323 })!;
  assertAlmostEquals(r.detections[0].bboxHeight, 0.4);
});

Deno.test("a whole-frame box is dropped when a specific box exists, kept when it is the only one", () => {
  const both = parseQwenReply('{"damage_type":"POTHOLE","confidence":0.9,"detections":[{"damage_type":"POTHOLE","box":[200,200,600,500]},{"damage_type":"CRACKED_ROAD","box":[0,0,1000,1000]}]}')!;
  assertEquals(both.detections.length, 1);
  assertEquals(both.detections[0].damageType, "POTHOLE");
  assertAlmostEquals(both.damagedAreaRatio, 0.12);

  const alone = parseQwenReply('{"damage_type":"CRACKED_ROAD","confidence":0.9,"detections":[{"box":[0,0,1000,1000]}]}')!;
  assertEquals(alone.detections.length, 1);
});
