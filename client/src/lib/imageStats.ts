import type { ImageStats } from "./types";
import { srgbToHsv, srgbToLab, relativeLuminance } from "./colorspace";
import {
  buildHistogram,
  cumulativeDistribution,
} from "./histogram";
import {
  averageInLBand,
  averageSaturation,
  cornerCenterLuminanceRatio,
  estimateNoiseLevel,
  midFrequencyContrast,
  rmsContrast,
} from "./statistics";

const LUMINANCE_BINS = 256;
const HUE_BINS = 8;
const SAT_BINS = 10;

/**
 * Resolution cap for analysis — bigger doesn't materially improve the
 * stats and slows the worker down a lot on phones.
 */
export const MAX_ANALYSIS_DIM = 768;

/**
 * Decode and downscale an image file to an ImageBitmap whose longest
 * side is <= MAX_ANALYSIS_DIM. Works in both the main thread and a
 * Web Worker (uses createImageBitmap, which both support).
 */
export async function decodeAndResize(
  source: Blob | ImageBitmap,
): Promise<ImageBitmap> {
  const bmp =
    source instanceof ImageBitmap
      ? source
      : await createImageBitmap(source);
  const longest = Math.max(bmp.width, bmp.height);
  if (longest <= MAX_ANALYSIS_DIM) return bmp;
  const scale = MAX_ANALYSIS_DIM / longest;
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const resized = await createImageBitmap(bmp, {
    resizeWidth: w,
    resizeHeight: h,
    resizeQuality: "medium",
  });
  bmp.close();
  return resized;
}

/**
 * Draw a bitmap into an OffscreenCanvas and return its ImageData.
 */
export function bitmapToImageData(bmp: ImageBitmap): ImageData {
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not acquire 2D context for analysis canvas");
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, bmp.width, bmp.height);
}

/**
 * Compute every per-image statistic we need to characterize the look.
 * The result is downstream-friendly: simple scalars and Float64Arrays
 * that are cheap to send across postMessage and easy to average.
 */
export function computeImageStats(image: ImageData): ImageStats {
  const { data, width, height } = image;
  const n = width * height;

  const lumLin = new Float64Array(n); // [0, 1] linear-ish luminance
  const lLab = new Float64Array(n); // [0, 100] L* from CIELAB
  const aLab = new Float64Array(n);
  const bLab = new Float64Array(n);
  const hueArr = new Float64Array(n); // [0, 360)
  const satArr = new Float64Array(n); // [0, 1]
  const valArr = new Float64Array(n); // [0, 1]

  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    const rgb: readonly [number, number, number] = [r, g, b];
    lumLin[i] = relativeLuminance(rgb);
    const [L, A, B] = srgbToLab(rgb);
    lLab[i] = L;
    aLab[i] = A;
    bLab[i] = B;
    const [H, S, V] = srgbToHsv(rgb);
    hueArr[i] = H;
    satArr[i] = S;
    valArr[i] = V;
  }

  const luminanceHist = buildHistogram(lLab, LUMINANCE_BINS, 0, 100);
  const luminanceCdf = cumulativeDistribution(luminanceHist);

  const hueHist = buildHistogram(hueArr, HUE_BINS, 0, 360);
  const satHist = buildHistogram(satArr, SAT_BINS, 0, 1);
  const lumHist = buildHistogram(valArr, SAT_BINS, 0, 1);

  // a/b averages per L-band (shadows: L<33, mids 33-67, highlights >67).
  const aShadows = averageInLBand(aLab, lLab, 0, 33);
  const aMids = averageInLBand(aLab, lLab, 33, 67);
  const aHighs = averageInLBand(aLab, lLab, 67, 101);
  const bShadows = averageInLBand(bLab, lLab, 0, 33);
  const bMids = averageInLBand(bLab, lLab, 33, 67);
  const bHighs = averageInLBand(bLab, lLab, 67, 101);

  return {
    width,
    height,
    luminanceCdf,
    aChannelByLBand: {
      shadows: aShadows,
      midtones: aMids,
      highlights: aHighs,
    },
    bChannelByLBand: {
      shadows: bShadows,
      midtones: bMids,
      highlights: bHighs,
    },
    hueBins: normalize(hueHist.bins),
    saturationBins: normalize(satHist.bins),
    luminanceBins: normalize(lumHist.bins),
    avgSaturation: averageSaturation(satArr),
    rmsContrast: rmsContrast(lumLin),
    midFreqContrast: midFrequencyContrast(lumLin, width, height),
    noiseLevel: estimateNoiseLevel(lumLin, width, height),
    cornerCenterLuminanceRatio: cornerCenterLuminanceRatio(
      lumLin,
      width,
      height,
    ),
  };
}

function normalize(bins: Float64Array): Float64Array {
  let total = 0;
  for (let i = 0; i < bins.length; i++) total += bins[i];
  if (total === 0) return new Float64Array(bins.length);
  const out = new Float64Array(bins.length);
  for (let i = 0; i < bins.length; i++) out[i] = bins[i] / total;
  return out;
}
