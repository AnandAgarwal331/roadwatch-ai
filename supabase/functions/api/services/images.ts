// Ported from backend/app/services/images.py. Same layered validation
// (size -> declared MIME -> actual decoded content) and the same
// normalisation (EXIF strip via re-encode, downscale, perceptual dHash).
//
// Uses jSquash (WASM codecs, Deno Deploy-compatible - no native/FFI deps)
// instead of Pillow. Resize uses jSquash's `lanczos3` method, matching
// PIL's `Image.LANCZOS`, but exact dHash bit-parity with the Python output
// is NOT achievable (different codec/resize implementations round
// differently at the pixel level - confirmed in the migration spike). This
// is an accepted, bounded gap: duplicate detection only compares complaints
// within DUPLICATE_WINDOW_DAYS of each other, so it only affects matching
// across the old/new hash schemes for ~30 days around cutover.

import encodeJpeg from "npm:@jsquash/jpeg@1.6.0/encode.js";
import resizeImg from "npm:@jsquash/resize@2.1.1/index.js";

import { settings } from "../_shared/config.ts";
import { ValidationError } from "../_shared/errors.ts";
import { sniffFormat, decodeByFormat } from "../_shared/image_codec.ts";

const FORMAT_TO_MIME: Record<string, string> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
const MIME_ALIASES: Record<string, string> = { "image/jpg": "image/jpeg" };

export interface ProcessedImage {
  data: Uint8Array;
  contentType: string;
  width: number;
  height: number;
  sizeBytes: number;
  perceptualHash: string;
}

export async function validateAndProcess(
  raw: Uint8Array,
  declaredContentType: string,
  opts: { maxBytes?: number; maxDimension?: number } = {},
): Promise<ProcessedImage> {
  const maxBytes = opts.maxBytes ?? settings.MAX_UPLOAD_BYTES;
  const maxDimension = opts.maxDimension ?? settings.IMAGE_MAX_DIMENSION;

  if (!raw || raw.length === 0) {
    throw new ValidationError("The uploaded file is empty.");
  }

  if (raw.length > maxBytes) {
    const limitMb = maxBytes / (1024 * 1024);
    const actualMb = raw.length / (1024 * 1024);
    throw new ValidationError(`That image is ${actualMb.toFixed(1)}MB. Please upload a file under ${limitMb.toFixed(0)}MB.`, {
      max_bytes: maxBytes,
      size_bytes: raw.length,
    });
  }

  // Declared-type gate first (coarse, trusts nothing about content yet) -
  // matches Python checking the client's Content-Type header before ever
  // touching the bytes.
  const declaredLower = (declaredContentType || "").toLowerCase();
  const declared = MIME_ALIASES[declaredLower] ?? declaredLower;
  const allowed = settings.ALLOWED_IMAGE_TYPES;
  if (declared && !allowed.includes(declared)) {
    throw new ValidationError("That file type is not supported. Please upload a JPEG, PNG or WebP image.", {
      allowed: [...allowed].sort(),
    });
  }

  // Now attempt to actually decode the content, regardless of what was
  // declared - PIL's Image.open().verify() auto-detects format from bytes,
  // and unrecognised/corrupt content fails here with "could not be read",
  // not "not supported" (that message is reserved for a real, decodable
  // image of a format outside the allowlist, e.g. a valid GIF).
  const detectedFormat = sniffFormat(raw);
  let decoded: ImageData;
  try {
    if (!detectedFormat) throw new Error("unrecognised format");
    decoded = await decodeByFormat(raw, detectedFormat);
  } catch {
    throw new ValidationError("That file could not be read as an image. It may be corrupted or not a real photo.");
  }

  const actualMime = FORMAT_TO_MIME[detectedFormat!];
  if (!actualMime || !allowed.includes(actualMime)) {
    throw new ValidationError("That file type is not supported. Please upload a JPEG, PNG or WebP image.", {
      detected: detectedFormat ?? "unknown",
      allowed: [...allowed].sort(),
    });
  }

  try {
    const orientation = detectedFormat === "jpeg" ? findExifOrientation(raw) : 1;
    const oriented = applyExifOrientation(decoded, orientation);
    const working = await thumbnail(oriented, maxDimension);
    const hash = await differenceHash(working);
    const { data, contentType } = await encode(working, actualMime);

    return {
      data,
      contentType,
      width: working.width,
      height: working.height,
      sizeBytes: data.length,
      perceptualHash: hash,
    };
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    throw new ValidationError("That image could not be processed. Please try a different photo.");
  }
}

async function encode(image: ImageData, _mime: string): Promise<{ data: Uint8Array; contentType: string }> {
  // Unlike Pillow, jSquash's PNG encoder path isn't wired up in this port
  // (RGBA support is a later addition once repair-evidence/PNG-with-alpha
  // needs are actually exercised) - every upload re-encodes to JPEG, same
  // as the Python path does for any non-alpha PNG input.
  const encoded = await encodeJpeg(image, { quality: 82 });
  return { data: new Uint8Array(encoded), contentType: "image/jpeg" };
}

// -- EXIF orientation (JPEG APP1/Exif segment, TIFF IFD0, tag 0x0112) -------

function findExifOrientation(bytes: Uint8Array): number {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
  let offset = 2;
  while (offset < bytes.length - 4) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0xd9) break;
    const segLen = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (marker === 0xe1) {
      const tiffStart = offset + 4 + 6;
      const exifTag = String.fromCharCode(...bytes.slice(offset + 4, offset + 4 + 4));
      if (exifTag === "Exif") {
        const little = bytes[tiffStart] === 0x49 && bytes[tiffStart + 1] === 0x49;
        const readU16 = (p: number) => (little ? bytes[p] | (bytes[p + 1] << 8) : (bytes[p] << 8) | bytes[p + 1]);
        const readU32 = (p: number) =>
          little
            ? bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16) | (bytes[p + 3] << 24)
            : (bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3];
        const ifd0Offset = tiffStart + readU32(tiffStart + 4);
        const numEntries = readU16(ifd0Offset);
        for (let i = 0; i < numEntries; i++) {
          const entryOffset = ifd0Offset + 2 + i * 12;
          if (readU16(entryOffset) === 0x0112) return readU16(entryOffset + 8);
        }
      }
      return 1;
    }
    offset += 2 + segLen;
  }
  return 1;
}

function rotateImageData(img: ImageData, degrees: 180 | 90 | -90): ImageData {
  const { width: w, height: h, data } = img;
  if (degrees === 180) {
    const out = new Uint8ClampedArray(data.length);
    for (let i = 0; i < w * h; i++) {
      out.set(data.subarray(i * 4, i * 4 + 4), (w * h - 1 - i) * 4);
    }
    return new ImageData(out, w, h);
  }
  const newW = h, newH = w;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const srcIdx = (y * w + x) * 4;
      const [dx, dy] = degrees === 90 ? [y, newH - 1 - x] : [newW - 1 - y, x];
      out.set(data.subarray(srcIdx, srcIdx + 4), (dy * newW + dx) * 4);
    }
  }
  return new ImageData(out, newW, newH);
}

function applyExifOrientation(img: ImageData, orientation: number): ImageData {
  if (orientation === 3) return rotateImageData(img, 180);
  if (orientation === 6) return rotateImageData(img, -90);
  if (orientation === 8) return rotateImageData(img, 90);
  return img; // 2,4,5,7 (flips) not handled - rare in practice, matches spike scope
}

// -- resize / hash -----------------------------------------------------------

async function thumbnail(img: ImageData, maxDim: number): Promise<ImageData> {
  const { width, height } = img;
  const scale = Math.min(1, maxDim / Math.max(width, height));
  if (scale >= 1) return img;
  const newW = Math.max(1, Math.round(width * scale));
  const newH = Math.max(1, Math.round(height * scale));
  return await resizeImg(img, { width: newW, height: newH, method: "lanczos3", fitMethod: "stretch" });
}

function toGreyscale(img: ImageData): ImageData {
  const { width, height, data } = img;
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    const l = Math.round(data[o] * 0.299 + data[o + 1] * 0.587 + data[o + 2] * 0.114);
    out[o] = out[o + 1] = out[o + 2] = l;
    out[o + 3] = 255;
  }
  return new ImageData(out, width, height);
}

/** 64-bit dHash: compares each pixel with its right-hand neighbour on a 9x8 greyscale thumbnail. */
async function differenceHash(img: ImageData, size = 8): Promise<string> {
  const grey = toGreyscale(img);
  const thumb = await resizeImg(grey, { width: size + 1, height: size, method: "lanczos3", fitMethod: "stretch" });
  let bits = 0n;
  let index = 0;
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const i1 = (row * (size + 1) + col) * 4;
      const i2 = (row * (size + 1) + col + 1) * 4;
      if (thumb.data[i1] > thumb.data[i2]) bits |= 1n << BigInt(index);
      index++;
    }
  }
  return bits.toString(16).padStart(16, "0");
}

export function hammingDistance(hashA: string | null | undefined, hashB: string | null | undefined): number {
  if (!hashA || !hashB) return 64;
  try {
    const a = BigInt(`0x${hashA}`);
    const b = BigInt(`0x${hashB}`);
    let x = a ^ b;
    let count = 0;
    while (x > 0n) {
      count += Number(x & 1n);
      x >>= 1n;
    }
    return count;
  } catch {
    return 64;
  }
}

export function imageSimilarity(hashA: string | null | undefined, hashB: string | null | undefined): number | null {
  if (!hashA || !hashB) return null;
  return Math.round((1.0 - hammingDistance(hashA, hashB) / 64.0) * 10000) / 10000;
}
