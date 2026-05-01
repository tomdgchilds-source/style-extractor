/**
 * Pure pixel pipeline that applies a {@link Profile}'s color transforms to a
 * single sRGB pixel.
 *
 * This is the function consumed by the 3D LUT writer (`cube.ts`) and is also
 * suitable for in-browser preview rendering. The pipeline is intentionally a
 * pragmatic approximation of the Lightroom rendering path — Lightroom is
 * closed-source — but is deterministic and captures the style's color identity
 * in a way that round-trips through a `.cube` file.
 *
 * All math operates in sRGB (gamma-encoded) space, which is the convention for
 * 3D LUTs in `.cube` files. Inputs and outputs are normalised to [0, 1] per
 * channel; the colorspace helpers in `./colorspace` work in [0, 255], so we
 * convert at the boundary.
 */
import { HSL_HUE_CENTERS, type HslHue, type Profile, type ToneCurvePoint } from "./types";
import { hsvToSrgb, labToSrgb, srgbToHsv, srgbToLab } from "./colorspace";

/** Hue zones, ordered by their hue centre (degrees). Used for HSL blending. */
const HSL_ZONES: readonly { readonly hue: HslHue; readonly center: number }[] = (
  Object.entries(HSL_HUE_CENTERS) as readonly [HslHue, number][]
)
  .map(([hue, center]) => ({ hue, center }))
  .sort((a, b) => a.center - b.center);

/** Strength multiplier applied to color-grading wheel saturation when offsetting LAB a/b. */
const COLOR_GRADING_STRENGTH = 0.15;
/** Strength multiplier applied to global wheel — full strength as per spec. */
const GLOBAL_GRADING_STRENGTH = 1.0;
/** Hue shift in degrees per unit HSL hue value. */
const HSL_HUE_SHIFT_DEGREES = 30;
/** Luminance shift per unit HSL luminance value (in HSV.V units). */
const HSL_LUM_SHIFT = 0.2;

/**
 * Apply the full {@link Profile} pipeline to a single sRGB pixel in [0, 1].
 *
 * Pipeline (in order):
 *   1. Tone curve on HSV.V.
 *   2. Per-zone HSL adjustments (blended between adjacent hue centres).
 *   3. Color grading: shadow/midtone/highlight wheels, blended by V.
 *   4. Global color-grading wheel applied across all V.
 *   5. Saturation and vibrance from {@link Profile.basic}.
 *   6. Clamp to [0, 1].
 *
 * @param rgb sRGB pixel in [0, 1] per channel.
 * @param profile Profile defining the transform stack.
 * @returns Transformed sRGB pixel in [0, 1] per channel.
 */
export function applyProfileToRgb01(
  rgb: readonly [number, number, number],
  profile: Profile,
): [number, number, number] {
  let r = clamp01(rgb[0]);
  let g = clamp01(rgb[1]);
  let b = clamp01(rgb[2]);

  // --- 1. Tone curve on V (HSV value) ---------------------------------------
  {
    const [h, s, v] = rgb01ToHsv([r, g, b]);
    if (v > 0) {
      const vNew = sampleToneCurve(profile.toneCurve, v);
      const scale = vNew / v;
      const [nr, ng, nb] = hsvToRgb01([h, s, clamp01(v * scale)]);
      r = nr;
      g = ng;
      b = nb;
    }
  }

  // --- 2. HSL per-zone adjustments ------------------------------------------
  {
    const [h, s, v] = rgb01ToHsv([r, g, b]);
    const { hueShift, satShift, lumShift } = blendHslAdjustments(profile, h);

    const newHue = (((h + hueShift * HSL_HUE_SHIFT_DEGREES) % 360) + 360) % 360;
    const newSat = clamp01(s * (1 + satShift));
    const newV = clamp01(v + lumShift * HSL_LUM_SHIFT);

    const [nr, ng, nb] = hsvToRgb01([newHue, newSat, newV]);
    r = nr;
    g = ng;
    b = nb;
  }

  // --- 3. Color grading: shadows / midtones / highlights blended by V -------
  {
    const v = Math.max(r, g, b);
    const wShadow = bandWeightShadows(v);
    const wMid = bandWeightMidtones(v);
    const wHigh = bandWeightHighlights(v);

    const [aOff, bOff] = sumWheelOffsets(
      [profile.colorGrading.shadows, wShadow],
      [profile.colorGrading.midtones, wMid],
      [profile.colorGrading.highlights, wHigh],
    );

    if (aOff !== 0 || bOff !== 0) {
      [r, g, b] = applyLabOffset([r, g, b], aOff, bOff);
    }
  }

  // --- 4. Global color-grading wheel ----------------------------------------
  {
    const [aOff, bOff] = wheelToAbOffset(profile.colorGrading.global, GLOBAL_GRADING_STRENGTH);
    if (aOff !== 0 || bOff !== 0) {
      [r, g, b] = applyLabOffset([r, g, b], aOff, bOff);
    }
  }

  // --- 5. Saturation / vibrance from basic ---------------------------------
  {
    const [h, s, v] = rgb01ToHsv([r, g, b]);
    const sSat = s * (1 + profile.basic.saturation);
    const sFinal = clamp01(sSat * (1 + profile.basic.vibrance * (1 - clamp01(sSat))));
    const [nr, ng, nb] = hsvToRgb01([h, sFinal, v]);
    r = nr;
    g = ng;
    b = nb;
  }

  // --- 6. Final clamp -------------------------------------------------------
  return [clamp01(r), clamp01(g), clamp01(b)];
}

// =============================================================================
// Tone curve
// =============================================================================

/**
 * Linearly interpolate the tone curve at input `x` in [0, 1]. Curve points are
 * assumed to be sorted by `input`. Out-of-range inputs clamp to the endpoints.
 */
function sampleToneCurve(curve: readonly ToneCurvePoint[], x: number): number {
  if (curve.length === 0) return clamp01(x);
  if (curve.length === 1) return clamp01(curve[0].output);

  if (x <= curve[0].input) return clamp01(curve[0].output);
  if (x >= curve[curve.length - 1].input) return clamp01(curve[curve.length - 1].output);

  for (let i = 0; i < curve.length - 1; i += 1) {
    const a = curve[i];
    const c = curve[i + 1];
    if (x >= a.input && x <= c.input) {
      const span = c.input - a.input;
      if (span <= 0) return clamp01(a.output);
      const t = (x - a.input) / span;
      return clamp01(a.output + t * (c.output - a.output));
    }
  }
  // Fallback (shouldn't be reachable for sorted curves).
  return clamp01(x);
}

// =============================================================================
// HSL per-zone blending
// =============================================================================

/**
 * Find the two HSL hue zones bracketing `hueDeg` and linearly blend their
 * adjustments. Hue is circular, so the blend wraps around 360°.
 */
function blendHslAdjustments(
  profile: Profile,
  hueDeg: number,
): { hueShift: number; satShift: number; lumShift: number } {
  const h = ((hueDeg % 360) + 360) % 360;

  // Find bracket [lo, hi] such that lo.center <= h < hi.center, with wrap-around.
  let loIdx = HSL_ZONES.length - 1;
  let hiIdx = 0;
  for (let i = 0; i < HSL_ZONES.length; i += 1) {
    const cur = HSL_ZONES[i].center;
    const next = HSL_ZONES[(i + 1) % HSL_ZONES.length].center;
    const nextWrapped = next <= cur ? next + 360 : next;
    if (h >= cur && h < nextWrapped) {
      loIdx = i;
      hiIdx = (i + 1) % HSL_ZONES.length;
      break;
    }
    // Handle the case where h is in the wrap segment (e.g. h=350 between magenta=300 and red=0+360).
    if (i === HSL_ZONES.length - 1) {
      loIdx = i;
      hiIdx = 0;
    }
  }

  const lo = HSL_ZONES[loIdx];
  const hi = HSL_ZONES[hiIdx];
  const loCenter = lo.center;
  const hiCenter = hi.center <= lo.center ? hi.center + 360 : hi.center;
  const span = hiCenter - loCenter;
  const t = span <= 0 ? 0 : (h - loCenter) / span;

  const loAdj = profile.hsl[lo.hue];
  const hiAdj = profile.hsl[hi.hue];

  return {
    hueShift: lerp(loAdj.hue, hiAdj.hue, t),
    satShift: lerp(loAdj.saturation, hiAdj.saturation, t),
    lumShift: lerp(loAdj.luminance, hiAdj.luminance, t),
  };
}

// =============================================================================
// Color grading: V-band weights + LAB offset
// =============================================================================

/**
 * Smooth-ish linear weight for the shadows band: 1 below 0.33, ramping to 0 by 0.5.
 */
function bandWeightShadows(v: number): number {
  if (v <= 0.33) return 1;
  if (v >= 0.5) return 0;
  return 1 - (v - 0.33) / (0.5 - 0.33);
}

/**
 * Linear weight for the midtones band: 0 below 0.33, peak 1 at 0.5, 0 above 0.67.
 */
function bandWeightMidtones(v: number): number {
  if (v <= 0.33 || v >= 0.67) return 0;
  if (v <= 0.5) return (v - 0.33) / (0.5 - 0.33);
  return 1 - (v - 0.5) / (0.67 - 0.5);
}

/**
 * Linear weight for the highlights band: 0 below 0.5, ramping to 1 by 0.67.
 */
function bandWeightHighlights(v: number): number {
  if (v >= 0.67) return 1;
  if (v <= 0.5) return 0;
  return (v - 0.5) / (0.67 - 0.5);
}

/** Convert a {@link ColorGradingWheel} to a LAB (a, b) offset vector. */
function wheelToAbOffset(
  wheel: { readonly hue: number; readonly saturation: number },
  strength: number,
): [number, number] {
  if (wheel.saturation <= 0 || strength <= 0) return [0, 0];
  const hueRad = (wheel.hue * Math.PI) / 180;
  // LAB a/b roughly span [-128, 127]; we scale by 100 to reach a useful magnitude.
  const magnitude = wheel.saturation * strength * 100;
  return [Math.cos(hueRad) * magnitude, Math.sin(hueRad) * magnitude];
}

/** Sum LAB (a, b) offsets from multiple weighted wheels. */
function sumWheelOffsets(
  ...entries: readonly (readonly [{ readonly hue: number; readonly saturation: number }, number])[]
): [number, number] {
  let aSum = 0;
  let bSum = 0;
  for (const [wheel, weight] of entries) {
    if (weight <= 0) continue;
    const [aOff, bOff] = wheelToAbOffset(wheel, COLOR_GRADING_STRENGTH);
    aSum += aOff * weight;
    bSum += bOff * weight;
  }
  return [aSum, bSum];
}

/** Apply an additive (a, b) offset in LAB space to an sRGB pixel in [0, 1]. */
function applyLabOffset(
  rgb01: readonly [number, number, number],
  aOff: number,
  bOff: number,
): [number, number, number] {
  const rgb255: [number, number, number] = [rgb01[0] * 255, rgb01[1] * 255, rgb01[2] * 255];
  const [L, a, bStar] = srgbToLab(rgb255);
  const out255 = labToSrgb([L, a + aOff, bStar + bOff]);
  return [out255[0] / 255, out255[1] / 255, out255[2] / 255];
}

// =============================================================================
// HSV ↔ RGB at [0, 1] scale
// =============================================================================

function rgb01ToHsv(rgb01: readonly [number, number, number]): [number, number, number] {
  const hsv = srgbToHsv([rgb01[0] * 255, rgb01[1] * 255, rgb01[2] * 255]);
  return [hsv[0], hsv[1], hsv[2]];
}

function hsvToRgb01(hsv: readonly [number, number, number]): [number, number, number] {
  const rgb255 = hsvToSrgb([hsv[0], hsv[1], hsv[2]]);
  return [rgb255[0] / 255, rgb255[1] / 255, rgb255[2] / 255];
}

// =============================================================================
// Misc
// =============================================================================

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
