// Shared JPEG/PNG/WebP decode used by both services/images.ts (upload
// validation) and providers/ai/mock.ts (the dev-stub's pixel stats), so
// there's one place that knows how to sniff and decode an image.

import decodeJpeg from "npm:@jsquash/jpeg@1.6.0/decode.js";
import decodePng from "npm:@jsquash/png@3.1.1/decode.js";
import decodeWebp from "npm:@jsquash/webp@1.5.0/decode.js";

export function sniffFormat(raw: Uint8Array): string | null {
  if (raw[0] === 0xff && raw[1] === 0xd8) return "jpeg";
  if (raw[0] === 0x89 && raw[1] === 0x50 && raw[2] === 0x4e && raw[3] === 0x47) return "png";
  if (
    raw.length > 11 &&
    raw[0] === 0x52 && raw[1] === 0x49 && raw[2] === 0x46 && raw[3] === 0x46 &&
    raw[8] === 0x57 && raw[9] === 0x45 && raw[10] === 0x42 && raw[11] === 0x50
  ) {
    return "webp";
  }
  return null;
}

export async function decodeByFormat(raw: Uint8Array, format: string): Promise<ImageData> {
  // jSquash's decoders type their param as ArrayBuffer, not Uint8Array -
  // `new Uint8Array(raw).buffer` guarantees an exactly-sized copy backing
  // buffer (raw's own .buffer may be larger/offset than raw itself).
  const buffer = new Uint8Array(raw).buffer;
  if (format === "jpeg") return await decodeJpeg(buffer);
  if (format === "png") return await decodePng(buffer);
  if (format === "webp") return await decodeWebp(buffer);
  throw new Error(`unsupported format: ${format}`);
}

export async function decodeAny(raw: Uint8Array): Promise<{ format: string; image: ImageData } | null> {
  const format = sniffFormat(raw);
  if (!format) return null;
  try {
    return { format, image: await decodeByFormat(raw, format) };
  } catch {
    return null;
  }
}
