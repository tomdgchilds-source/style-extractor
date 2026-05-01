/**
 * Colorspace conversion utilities.
 *
 * All conversions use the standard sRGB transfer function (piecewise: linear
 * below 0.04045, gamma 2.4 above) and the D65 reference white for CIELAB.
 *
 * Conventions:
 *   RGB: [r, g, b], each in [0, 255]
 *   LAB: [L, a, b], L in [0, 100], a/b in [-128, 127]
 *   HSV: [h, s, v], h in [0, 360), s/v in [0, 1]
 */

import type { HSV, LAB, RGB } from "./types";

// D65 reference white tristimulus values (CIE 1931 2-degree observer).
const D65_XN = 95.047;
const D65_YN = 100.0;
const D65_ZN = 108.883;

// CIELAB epsilon and kappa constants (from CIE).
const LAB_EPSILON = 216 / 24389; // ~0.008856
const LAB_KAPPA = 24389 / 27; // ~903.3

// sRGB <-> linear-RGB <-> XYZ matrices (D65). Bradford-adapted.
const M_RGB_TO_XYZ: readonly (readonly [number, number, number])[] = [
  [0.4124564, 0.3575761, 0.1804375],
  [0.2126729, 0.7151522, 0.072175],
  [0.0193339, 0.119192, 0.9503041],
] as const;

const M_XYZ_TO_RGB: readonly (readonly [number, number, number])[] = [
  [3.2404542, -1.5371385, -0.4985314],
  [-0.969266, 1.8760108, 0.041556],
  [0.0556434, -0.2040259, 1.0572252],
] as const;

/**
 * Gamma-decode a single sRGB channel value (0..1) to linear light (0..1).
 * Uses the piecewise sRGB transfer function.
 */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Gamma-encode a single linear-light channel value (0..1) back to sRGB (0..1).
 * Inverse of {@link srgbToLinear}.
 */
export function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/**
 * Compute the relative luminance Y (0..1) of an sRGB color per Rec. 709 / sRGB.
 */
export function relativeLuminance(rgb: RGB): number {
  const [r, g, b] = rgb;
  const rl = srgbToLinear(r / 255);
  const gl = srgbToLinear(g / 255);
  const bl = srgbToLinear(b / 255);
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

/**
 * Convert sRGB ([0..255]) to CIELAB via linear sRGB and XYZ (D65 white point).
 */
export function srgbToLab(rgb: RGB): LAB {
  const [r, g, b] = rgb;
  const rl = srgbToLinear(r / 255);
  const gl = srgbToLinear(g / 255);
  const bl = srgbToLinear(b / 255);

  // Linear RGB -> XYZ (scaled to match Yn=100).
  const x = (M_RGB_TO_XYZ[0][0] * rl + M_RGB_TO_XYZ[0][1] * gl + M_RGB_TO_XYZ[0][2] * bl) * 100;
  const y = (M_RGB_TO_XYZ[1][0] * rl + M_RGB_TO_XYZ[1][1] * gl + M_RGB_TO_XYZ[1][2] * bl) * 100;
  const z = (M_RGB_TO_XYZ[2][0] * rl + M_RGB_TO_XYZ[2][1] * gl + M_RGB_TO_XYZ[2][2] * bl) * 100;

  const fx = labF(x / D65_XN);
  const fy = labF(y / D65_YN);
  const fz = labF(z / D65_ZN);

  const L = 116 * fy - 16;
  const a = 500 * (fx - fy);
  const bStar = 200 * (fy - fz);

  return [L, a, bStar] as const;
}

/**
 * Convert CIELAB to sRGB ([0..255]). Output is clamped per channel to [0, 255].
 */
export function labToSrgb(lab: LAB): RGB {
  const [L, a, bStar] = lab;

  const fy = (L + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - bStar / 200;

  const x = D65_XN * labFInv(fx);
  const y = D65_YN * labFInv(fy);
  const z = D65_ZN * labFInv(fz);

  // XYZ (Yn=100 scale) -> linear RGB.
  const rl =
    M_XYZ_TO_RGB[0][0] * (x / 100) + M_XYZ_TO_RGB[0][1] * (y / 100) + M_XYZ_TO_RGB[0][2] * (z / 100);
  const gl =
    M_XYZ_TO_RGB[1][0] * (x / 100) + M_XYZ_TO_RGB[1][1] * (y / 100) + M_XYZ_TO_RGB[1][2] * (z / 100);
  const bl =
    M_XYZ_TO_RGB[2][0] * (x / 100) + M_XYZ_TO_RGB[2][1] * (y / 100) + M_XYZ_TO_RGB[2][2] * (z / 100);

  const r = linearToSrgb(clamp01(rl)) * 255;
  const g = linearToSrgb(clamp01(gl)) * 255;
  const b = linearToSrgb(clamp01(bl)) * 255;

  return [clampByte(r), clampByte(g), clampByte(b)] as const;
}

/**
 * Convert sRGB ([0..255]) to HSV. Hue is in [0, 360), saturation/value in [0, 1].
 */
export function srgbToHsv(rgb: RGB): HSV {
  const r = rgb[0] / 255;
  const g = rgb[1] / 255;
  const b = rgb[2] / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta > 0) {
    if (max === r) {
      h = 60 * (((g - b) / delta) % 6);
    } else if (max === g) {
      h = 60 * ((b - r) / delta + 2);
    } else {
      h = 60 * ((r - g) / delta + 4);
    }
  }
  if (h < 0) h += 360;
  if (h >= 360) h -= 360;

  const s = max === 0 ? 0 : delta / max;
  const v = max;

  return [h, s, v] as const;
}

/**
 * Convert HSV (h in [0, 360), s/v in [0, 1]) to sRGB ([0..255]).
 */
export function hsvToSrgb(hsv: HSV): RGB {
  const [hRaw, s, v] = hsv;
  const h = ((hRaw % 360) + 360) % 360;

  const c = v * s;
  const hPrime = h / 60;
  const x = c * (1 - Math.abs((hPrime % 2) - 1));

  let r1 = 0;
  let g1 = 0;
  let b1 = 0;

  if (hPrime >= 0 && hPrime < 1) {
    r1 = c;
    g1 = x;
  } else if (hPrime < 2) {
    r1 = x;
    g1 = c;
  } else if (hPrime < 3) {
    g1 = c;
    b1 = x;
  } else if (hPrime < 4) {
    g1 = x;
    b1 = c;
  } else if (hPrime < 5) {
    r1 = x;
    b1 = c;
  } else {
    r1 = c;
    b1 = x;
  }

  const m = v - c;
  return [clampByte((r1 + m) * 255), clampByte((g1 + m) * 255), clampByte((b1 + m) * 255)] as const;
}

// ---- internal helpers ----

function labF(t: number): number {
  return t > LAB_EPSILON ? Math.cbrt(t) : (LAB_KAPPA * t + 16) / 116;
}

function labFInv(ft: number): number {
  const ft3 = ft * ft * ft;
  return ft3 > LAB_EPSILON ? ft3 : (116 * ft - 16) / LAB_KAPPA;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clampByte(v: number): number {
  if (v < 0) return 0;
  if (v > 255) return 255;
  return v;
}
