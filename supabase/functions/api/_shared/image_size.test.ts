import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { readImageSize } from "./image_size.ts";

const be16 = (n: number) => [(n >> 8) & 255, n & 255];
const be32 = (n: number) => [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
const text = (s: string) => [...s].map((c) => c.charCodeAt(0));

Deno.test("reads a JPEG's size past other segments (SOF0 after an APP0 block)", () => {
  const bytes = new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, ...be16(16), ...new Array(14).fill(0),
    0xff, 0xc0, ...be16(17), 8, ...be16(323), ...be16(485), 3, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);
  assertEquals(readImageSize(bytes), { width: 485, height: 323 });
});

Deno.test("reads a PNG's size from IHDR", () => {
  const bytes = new Uint8Array([0x89, ...text("PNG"), 13, 10, 26, 10, ...be32(13), ...text("IHDR"), ...be32(640), ...be32(480), 8, 6, 0, 0, 0]);
  assertEquals(readImageSize(bytes), { width: 640, height: 480 });
});

Deno.test("reads a lossy WebP (VP8) and an extended WebP (VP8X)", () => {
  const vp8 = new Uint8Array([...text("RIFF"), 0, 0, 0, 0, ...text("WEBP"), ...text("VP8 "), 0, 0, 0, 0, 0, 0, 0, 0x9d, 0x01, 0x2a, 800 & 255, 800 >> 8, 600 & 255, 600 >> 8, 0, 0]);
  assertEquals(readImageSize(vp8), { width: 800, height: 600 });

  const w = 1024 - 1;
  const h = 768 - 1;
  const vp8x = new Uint8Array([...text("RIFF"), 0, 0, 0, 0, ...text("WEBP"), ...text("VP8X"), 10, 0, 0, 0, 0, 0, 0, 0, w & 255, (w >> 8) & 255, 0, h & 255, (h >> 8) & 255, 0, 0, 0]);
  assertEquals(readImageSize(vp8x), { width: 1024, height: 768 });
});

Deno.test("unrecognised or truncated data returns null instead of guessing", () => {
  assertEquals(readImageSize(new Uint8Array([1, 2, 3, 4, 5])), null);
  assertEquals(readImageSize(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), null);
  assertEquals(readImageSize(new Uint8Array(0)), null);
});
