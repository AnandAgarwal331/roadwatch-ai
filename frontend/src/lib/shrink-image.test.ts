import { afterEach, describe, expect, it, vi } from "vitest";

import { SHRINK_ABOVE_BYTES, shrinkForUpload } from "./shrink-image";

function fileOfSize(bytes: number, name = "pothole.jpg") {
  return new File([new Uint8Array(bytes)], name, { type: "image/jpeg" });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("shrinkForUpload", () => {
  it("leaves a photo under the threshold exactly as it is", async () => {
    const bitmap = vi.fn();
    vi.stubGlobal("createImageBitmap", bitmap);
    const file = fileOfSize(SHRINK_ABOVE_BYTES);

    expect(await shrinkForUpload(file)).toBe(file);
    expect(bitmap).not.toHaveBeenCalled();
  });

  it("returns the original when the browser cannot decode images this way", async () => {
    vi.stubGlobal("createImageBitmap", undefined);
    const file = fileOfSize(SHRINK_ABOVE_BYTES + 1);

    expect(await shrinkForUpload(file)).toBe(file);
  });

  it("returns the original, rather than failing the upload, if decoding throws", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new Error("corrupt")));
    const file = fileOfSize(SHRINK_ABOVE_BYTES + 1);

    expect(await shrinkForUpload(file)).toBe(file);
  });

  it("returns the original when there is no canvas to draw on", async () => {
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 4000, height: 3000, close }));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const file = fileOfSize(SHRINK_ABOVE_BYTES + 1);

    expect(await shrinkForUpload(file)).toBe(file);
    expect(close).toHaveBeenCalled();
  });
});
