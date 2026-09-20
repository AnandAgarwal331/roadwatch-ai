// Width/height read straight from an image's header bytes (JPEG, PNG, WebP),
// without decoding the pixels. Returns null for anything unrecognised or
// truncated rather than guessing.

export interface ImageSize {
  width: number;
  height: number;
}

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

function jpegSize(b: Uint8Array): ImageSize | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = b[i + 1];
    if (marker === 0xff) {
      i++;
      continue;
    }
    // Standalone markers carry no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2;
      continue;
    }
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      const height = u16be(b, i + 5);
      const width = u16be(b, i + 7);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    i += 2 + u16be(b, i + 2);
  }
  return null;
}

function pngSize(b: Uint8Array): ImageSize | null {
  if (b.length < 24 || ascii(b, 12, 4) !== "IHDR") return null;
  const width = u32be(b, 16);
  const height = u32be(b, 20);
  return width > 0 && height > 0 ? { width, height } : null;
}

function webpSize(b: Uint8Array): ImageSize | null {
  if (b.length < 30) return null;
  const chunk = ascii(b, 12, 4);
  if (chunk === "VP8 ") {
    return { width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff };
  }
  if (chunk === "VP8L") {
    const width = 1 + (b[21] | ((b[22] & 0x3f) << 8));
    const height = 1 + ((b[22] >> 6) | (b[23] << 2) | ((b[24] & 0x0f) << 10));
    return { width, height };
  }
  if (chunk === "VP8X") {
    return {
      width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)),
      height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)),
    };
  }
  return null;
}

export function readImageSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return jpegSize(bytes);
  if (bytes.length > 8 && bytes[0] === 0x89 && ascii(bytes, 1, 3) === "PNG") return pngSize(bytes);
  if (bytes.length > 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return webpSize(bytes);
  return null;
}
