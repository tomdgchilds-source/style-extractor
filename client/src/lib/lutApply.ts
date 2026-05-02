import type { Profile } from "./types";
import { applyProfileToRgb01 } from "./applyProfile";

/**
 * Default 3D LUT cube size. 33³ ≈ 36k samples, the de-facto standard
 * for video/photo grading — enough fidelity that trilinear interpolation
 * between samples is visually indistinguishable from running the full
 * profile pipeline per pixel.
 */
export const DEFAULT_LUT_SIZE = 33;

export interface BakedLut {
  readonly size: number;
  readonly data: Float32Array; // length = size * size * size * 3
}

/**
 * Sample the full Profile pipeline on a uniform grid and store the
 * results as a flat Float32Array. Indexing matches the .cube spec —
 * R varies fastest, then G, then B.
 *
 * Once baked, applying the LUT to a photo is just a fast trilinear
 * lookup per pixel (~10x faster than the full pipeline per pixel).
 */
export function bakeLut(
  profile: Profile,
  size: number = DEFAULT_LUT_SIZE,
): BakedLut {
  if (size < 2) throw new Error("LUT size must be >= 2");
  const data = new Float32Array(size * size * size * 3);
  const denom = size - 1;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const rIn = r / denom;
        const gIn = g / denom;
        const bIn = b / denom;
        const [rO, gO, bO] = applyProfileToRgb01([rIn, gIn, bIn], profile);
        const idx = ((b * size + g) * size + r) * 3;
        data[idx] = rO;
        data[idx + 1] = gO;
        data[idx + 2] = bO;
      }
    }
  }
  return { size, data };
}

/**
 * Trilinear interpolation through a baked LUT. Inputs and outputs are
 * sRGB in [0, 1]. Blends the 8 surrounding LUT corners by the pixel's
 * fractional position.
 */
export function applyLutToPixel01(
  lut: BakedLut,
  r01: number,
  g01: number,
  b01: number,
): [number, number, number] {
  const { size, data } = lut;
  const denom = size - 1;
  const rPos = clamp01(r01) * denom;
  const gPos = clamp01(g01) * denom;
  const bPos = clamp01(b01) * denom;

  const r0 = Math.floor(rPos);
  const g0 = Math.floor(gPos);
  const b0 = Math.floor(bPos);
  const r1 = r0 < denom ? r0 + 1 : r0;
  const g1 = g0 < denom ? g0 + 1 : g0;
  const b1 = b0 < denom ? b0 + 1 : b0;

  const fr = rPos - r0;
  const fg = gPos - g0;
  const fb = bPos - b0;

  const i000 = ((b0 * size + g0) * size + r0) * 3;
  const i001 = ((b1 * size + g0) * size + r0) * 3;
  const i010 = ((b0 * size + g1) * size + r0) * 3;
  const i011 = ((b1 * size + g1) * size + r0) * 3;
  const i100 = ((b0 * size + g0) * size + r1) * 3;
  const i101 = ((b1 * size + g0) * size + r1) * 3;
  const i110 = ((b0 * size + g1) * size + r1) * 3;
  const i111 = ((b1 * size + g1) * size + r1) * 3;

  const out: [number, number, number] = [0, 0, 0];
  for (let ch = 0; ch < 3; ch++) {
    const v000 = data[i000 + ch];
    const v001 = data[i001 + ch];
    const v010 = data[i010 + ch];
    const v011 = data[i011 + ch];
    const v100 = data[i100 + ch];
    const v101 = data[i101 + ch];
    const v110 = data[i110 + ch];
    const v111 = data[i111 + ch];

    const v00 = v000 * (1 - fr) + v100 * fr;
    const v01 = v001 * (1 - fr) + v101 * fr;
    const v10 = v010 * (1 - fr) + v110 * fr;
    const v11 = v011 * (1 - fr) + v111 * fr;

    const v0 = v00 * (1 - fg) + v10 * fg;
    const v1 = v01 * (1 - fg) + v11 * fg;

    out[ch] = v0 * (1 - fb) + v1 * fb;
  }
  return out;
}

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}
