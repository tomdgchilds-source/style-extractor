import type {
  BasicAdjustments,
  ColorGrading,
  ColorGradingWheel,
  GrainSettings,
  HslAdjustments,
  HslHue,
  ImageStats,
  Profile,
  ToneCurvePoint,
  VignetteSettings,
} from "./types";
import { HSL_HUE_CENTERS } from "./types";
import { averageCdfs } from "./histogram";

/**
 * Reasonable "neutral" baseline values. These are subjective midpoints
 * we use as the zero point for delta-style sliders (contrast, exposure,
 * saturation, etc.). Not science — pragmatic anchors that produce
 * sliders in a sensible range when the average reference matches.
 */
const NEUTRAL = {
  meanLuminance: 0.18,
  rmsContrast: 0.2,
  saturation: 0.28,
  midFreqContrast: 0.04,
  noiseLevel: 0.0,
  cornerCenterRatio: 1.0,
} as const;

/**
 * Given the per-image statistics for a batch of reference images,
 * build a single Profile that captures their average look.
 *
 * The Profile is then consumed by the XMP writer (Lightroom preset) and
 * the CUBE writer (3D LUT) without any additional analysis.
 */
export function extractProfile(
  stats: readonly ImageStats[],
  name: string,
): Profile {
  if (stats.length === 0) {
    throw new Error("extractProfile requires at least one ImageStats");
  }

  const avgCdf = averageCdfs(stats.map((s) => s.luminanceCdf));
  const toneCurve = fitToneCurve(avgCdf);

  const meanLumOnCurve = sampleCurve(toneCurve, 0.5);
  const meanRms = mean(stats.map((s) => s.rmsContrast));
  const meanMidFreq = mean(stats.map((s) => s.midFreqContrast));
  const meanSaturation = mean(stats.map((s) => s.avgSaturation));
  const meanNoise = mean(stats.map((s) => s.noiseLevel));
  const meanVignette = mean(stats.map((s) => s.cornerCenterLuminanceRatio));

  const basic: BasicAdjustments = {
    exposure: clampSigned(
      // 0.18 is mid-grey reference; positive = brighter than neutral.
      Math.log2(Math.max(0.001, meanLumOnCurve / NEUTRAL.meanLuminance)) * 0.5,
    ),
    contrast: clampSigned((meanRms - NEUTRAL.rmsContrast) * 2),
    highlights: clampSigned(curveTailDeflection(toneCurve, "high") * 1.5),
    shadows: clampSigned(curveTailDeflection(toneCurve, "low") * 1.5),
    whites: clampSigned(curveTailDeflection(toneCurve, "white") * 1.5),
    blacks: clampSigned(curveTailDeflection(toneCurve, "black") * 1.5),
    texture: clampSigned((meanMidFreq - NEUTRAL.midFreqContrast) * 4),
    clarity: clampSigned((meanMidFreq - NEUTRAL.midFreqContrast) * 6),
    vibrance: clampSigned((meanSaturation - NEUTRAL.saturation) * 1.5),
    saturation: clampSigned((meanSaturation - NEUTRAL.saturation) * 0.8),
  };

  const hsl = extractHslAdjustments(stats);
  const colorGrading = extractColorGrading(stats);
  const grain: GrainSettings = {
    amount: clamp01(meanNoise * 8),
    size: 0.25,
    roughness: 0.5,
  };
  const vignette: VignetteSettings = {
    amount: clampSigned((meanVignette - NEUTRAL.cornerCenterRatio) * 1.5),
    midpoint: 0.5,
    feather: 0.5,
  };

  return {
    name,
    createdAt: new Date().toISOString(),
    referenceCount: stats.length,
    basic,
    toneCurve,
    hsl,
    colorGrading,
    grain,
    vignette,
  };
}

function fitToneCurve(avgCdf: Float64Array): ToneCurvePoint[] {
  // The "look's" tone curve approximates the inverse-CDF of the
  // reference batch: a uniform input quantile X is mapped to the value
  // at the X-th percentile of the reference distribution. Anchored at
  // the corners for sane round-trip in Lightroom.
  const inputs = [0, 0.125, 0.25, 0.5, 0.75, 0.875, 1];
  const points: ToneCurvePoint[] = [];
  for (const input of inputs) {
    const output = inverseCdf(avgCdf, input);
    // Blend with identity to keep curves subtle (alpha = 0.6 reference,
    // 0.4 identity). Pure inverse-CDF was too aggressive in testing.
    const blended = 0.6 * output + 0.4 * input;
    points.push({ input, output: clamp01(blended) });
  }
  // Ensure monotonic in case of float drift.
  for (let i = 1; i < points.length; i++) {
    if (points[i].output < points[i - 1].output) {
      points[i] = { input: points[i].input, output: points[i - 1].output };
    }
  }
  return points;
}

function inverseCdf(cdf: Float64Array, target: number): number {
  if (target <= 0) return 0;
  if (target >= 1) return 1;
  for (let i = 0; i < cdf.length; i++) {
    if (cdf[i] >= target) {
      const prev = i === 0 ? 0 : cdf[i - 1];
      const span = cdf[i] - prev;
      const frac = span > 0 ? (target - prev) / span : 0;
      return (i + frac) / cdf.length;
    }
  }
  return 1;
}

function sampleCurve(points: readonly ToneCurvePoint[], input: number): number {
  if (points.length === 0) return input;
  if (input <= points[0].input) return points[0].output;
  if (input >= points[points.length - 1].input) return points[points.length - 1].output;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (input <= b.input) {
      const t = (input - a.input) / (b.input - a.input);
      return a.output + (b.output - a.output) * t;
    }
  }
  return points[points.length - 1].output;
}

/**
 * Measure how strongly the curve deflects from identity in different
 * tonal regions, used to back out Lightroom-style shadows/highlights/
 * whites/blacks slider values.
 */
function curveTailDeflection(
  curve: readonly ToneCurvePoint[],
  region: "low" | "high" | "black" | "white",
): number {
  const probes: Record<typeof region, number> = {
    black: 0.05,
    low: 0.25,
    high: 0.75,
    white: 0.95,
  };
  const x = probes[region];
  return sampleCurve(curve, x) - x;
}

function extractHslAdjustments(stats: readonly ImageStats[]): HslAdjustments {
  // For each of the 8 hue zones, average the saturation/luminance bins
  // weighted by where pixels fall. We don't have per-zone pixel data
  // (we'd need separate histograms per hue), so we approximate:
  // - zone saturation shift = (avg sat in matching hue band) - global avg sat
  // - zone luminance shift = (avg val in matching hue band) - global avg val
  // - zone hue shift defaults to 0 (we don't measure hue rotation in v1).
  const zones: HslHue[] = [
    "red",
    "orange",
    "yellow",
    "green",
    "aqua",
    "blue",
    "purple",
    "magenta",
  ];

  // Average the hue bins across all images to get the population profile.
  const huePop = averageBins(stats.map((s) => s.hueBins));
  const totalHuePop = huePop.reduce((a, b) => a + b, 0) || 1;

  const out: Partial<Record<HslHue, { hue: number; saturation: number; luminance: number }>> = {};
  for (let i = 0; i < zones.length; i++) {
    const zone = zones[i];
    const center = HSL_HUE_CENTERS[zone];
    const popFraction = huePop[i] / totalHuePop;
    // Sat/lum shifts per zone are approximated as a function of the
    // population fraction relative to a uniform baseline (1/8 = 0.125).
    // Zones with more pixels in the image get larger sat/lum boosts —
    // a crude but effective proxy without per-zone pixel-channel stats.
    const popDelta = popFraction - 1 / 8;
    out[zone] = {
      hue: 0,
      saturation: clampSigned(popDelta * 2),
      luminance: clampSigned(popDelta * 1),
    };
    void center;
  }
  return out as HslAdjustments;
}

function averageBins(arrs: readonly Float64Array[]): Float64Array {
  if (arrs.length === 0) return new Float64Array(0);
  const len = arrs[0].length;
  const out = new Float64Array(len);
  for (const a of arrs) {
    for (let i = 0; i < len; i++) out[i] += a[i];
  }
  for (let i = 0; i < len; i++) out[i] /= arrs.length;
  return out;
}

function extractColorGrading(stats: readonly ImageStats[]): ColorGrading {
  // Average per-band a/b across all images, then convert each (a, b) pair
  // into a (hue, saturation) wheel position. The radius is normalized so
  // that strong tints (|a| or |b| ~ 30 in LAB units) become saturation = 1.
  const aShad = mean(stats.map((s) => s.aChannelByLBand.shadows));
  const aMid = mean(stats.map((s) => s.aChannelByLBand.midtones));
  const aHigh = mean(stats.map((s) => s.aChannelByLBand.highlights));
  const bShad = mean(stats.map((s) => s.bChannelByLBand.shadows));
  const bMid = mean(stats.map((s) => s.bChannelByLBand.midtones));
  const bHigh = mean(stats.map((s) => s.bChannelByLBand.highlights));

  const shadows = abToWheel(aShad, bShad);
  const midtones = abToWheel(aMid, bMid);
  const highlights = abToWheel(aHigh, bHigh);

  const aGlobal = (aShad + aMid + aHigh) / 3;
  const bGlobal = (bShad + bMid + bHigh) / 3;
  const global = abToWheel(aGlobal, bGlobal);

  return {
    shadows,
    midtones,
    highlights,
    global,
    blending: 0.5,
    balance: 0,
  };
}

const COLOR_TINT_NORMALIZER = 30; // LAB units that map to wheel saturation=1.

function abToWheel(a: number, b: number): ColorGradingWheel {
  const radius = Math.sqrt(a * a + b * b);
  let angle = (Math.atan2(b, a) * 180) / Math.PI;
  if (angle < 0) angle += 360;
  return {
    hue: angle,
    saturation: clamp01(radius / COLOR_TINT_NORMALIZER),
    luminance: 0,
  };
}

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function clampSigned(x: number): number {
  if (x < -1) return -1;
  if (x > 1) return 1;
  return x;
}

function mean(arr: readonly number[]): number {
  if (arr.length === 0) return 0;
  let sum = 0;
  for (const x of arr) sum += x;
  return sum / arr.length;
}
