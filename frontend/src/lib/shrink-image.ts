/**
 * Shrinks a large photo in the browser before it is uploaded.
 *
 * Every upload passes through the Next.js `/api/proxy` route, and serverless
 * hosts cap the size of a request body (Vercel's limit is 4.5 MB) well below
 * the 10 MB the form accepts, so a straight-from-the-camera photo would be
 * rejected before it ever reached the backend. The backend downsizes every
 * image to `IMAGE_MAX_DIMENSION` and re-encodes it as JPEG anyway, so doing
 * the same here first changes nothing about what is stored or analysed - it
 * only stops the extra megapixels being sent over the wire.
 *
 * Falls back to the original file whenever anything goes wrong or the result
 * is not smaller: an upload that is too big for the host fails with a clear
 * message, whereas a broken shrinker must never be the reason a report cannot
 * be sent.
 */

/** Same value as IMAGE_MAX_DIMENSION in the Edge Function's config. */
export const UPLOAD_MAX_DIMENSION = 1600;

/** Files at or below this go up untouched, so ordinary photos are never re-encoded twice. */
export const SHRINK_ABOVE_BYTES = 3 * 1024 * 1024;

const JPEG_QUALITY = 0.85;

export async function shrinkForUpload(file: File): Promise<File> {
  if (file.size <= SHRINK_ABOVE_BYTES) return file;
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return file;

  try {
    // Applies the photo's EXIF rotation, so the smaller copy is the right way up.
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, UPLOAD_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return file;
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
    if (!blob || blob.size >= file.size) return file;

    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  }
}
