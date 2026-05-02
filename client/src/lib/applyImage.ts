import type { Profile } from "./types";
import { applyLutToPixel01, bakeLut, type BakedLut } from "./lutApply";

/**
 * Cap on the longest edge for processed output. iPhone photos are
 * routinely 12MP+ which is too much JS-pixel work in a browser worker.
 * 2048 is a sensible default that's plenty for screen viewing and
 * social-media posting.
 */
export const MAX_APPLY_DIM = 2048;

/**
 * Encode quality for the output JPEG. 0.92 keeps the file small while
 * staying visually lossless on most photographic content.
 */
export const APPLY_JPEG_QUALITY = 0.92;

export interface ApplyResult {
  readonly fileName: string;
  /** JPEG of the (possibly downscaled) original. */
  readonly beforeBlob: Blob;
  /** JPEG of the filtered output. */
  readonly afterBlob: Blob;
  readonly width: number;
  readonly height: number;
  readonly mime: "image/jpeg";
}

/**
 * Apply a Profile to a single image. Returns before/after JPEGs at the
 * (possibly downscaled) processing resolution.
 *
 * `strength` blends between original (0) and fully filtered (1).
 *
 * If you're going to apply the same profile to many images, bake the
 * LUT once with `bakeLut(profile)` and pass it via `cachedLut` — this
 * skips the (~36k-sample) baking step for every subsequent image.
 */
export async function applyToImage(
  file: File | Blob,
  profile: Profile,
  options: {
    strength?: number;
    cachedLut?: BakedLut;
    fileName?: string;
    maxDim?: number;
  } = {},
): Promise<ApplyResult> {
  const strength = clampUnit(options.strength ?? 1);
  const lut = options.cachedLut ?? bakeLut(profile);
  const maxDim = options.maxDim ?? MAX_APPLY_DIM;

  const bitmap = await createImageBitmap(file);
  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = longest > maxDim ? maxDim / longest : 1;
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not get 2D context for apply canvas");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  // Snapshot the original (post-resize) before mutating.
  const beforeBlob = await canvas.convertToBlob({
    type: "image/jpeg",
    quality: APPLY_JPEG_QUALITY,
  });

  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  const len = data.length;

  if (strength <= 0) {
    // No-op: after = before.
    return {
      fileName: options.fileName ?? "image.jpg",
      beforeBlob,
      afterBlob: beforeBlob.slice(0),
      width: w,
      height: h,
      mime: "image/jpeg",
    };
  }

  const inv = 1 - strength;
  for (let i = 0; i < len; i += 4) {
    const r01 = data[i] / 255;
    const g01 = data[i + 1] / 255;
    const b01 = data[i + 2] / 255;
    const [rOut, gOut, bOut] = applyLutToPixel01(lut, r01, g01, b01);
    data[i] = clampByte((r01 * inv + rOut * strength) * 255);
    data[i + 1] = clampByte((g01 * inv + gOut * strength) * 255);
    data[i + 2] = clampByte((b01 * inv + bOut * strength) * 255);
    // alpha (data[i + 3]) untouched
  }
  ctx.putImageData(imageData, 0, 0);

  const afterBlob = await canvas.convertToBlob({
    type: "image/jpeg",
    quality: APPLY_JPEG_QUALITY,
  });

  return {
    fileName: options.fileName ?? "image.jpg",
    beforeBlob,
    afterBlob,
    width: w,
    height: h,
    mime: "image/jpeg",
  };
}

function clampUnit(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function clampByte(x: number): number {
  if (x < 0) return 0;
  if (x > 255) return 255;
  return Math.round(x);
}
