/**
 * 1D histogram math used by the style extractor.
 *
 * All functions are pure and side-effect free. Counts and CDFs are stored in
 * `Float64Array` for cache-friendly access and to keep arithmetic in double
 * precision throughout the pipeline.
 */

import type { Histogram } from "./types";

/**
 * Build a histogram by counting `values` into `binCount` equal-width bins
 * spanning the closed interval `[min, max]`.
 *
 * Values outside `[min, max]` are clamped to the nearest edge bin. The final
 * bin is inclusive of `max` (so `value === max` lands in `bins[binCount - 1]`).
 *
 * @throws if `binCount < 1` or `max <= min`.
 */
export function buildHistogram(
  values: ArrayLike<number>,
  binCount: number,
  min: number,
  max: number,
): Histogram {
  if (!Number.isFinite(binCount) || binCount < 1 || !Number.isInteger(binCount)) {
    throw new Error(`buildHistogram: binCount must be a positive integer, got ${binCount}`);
  }
  if (!(max > min)) {
    throw new Error(`buildHistogram: max (${max}) must be greater than min (${min})`);
  }

  const bins = new Float64Array(binCount);
  const range = max - min;
  const lastBin = binCount - 1;

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    let idx: number;
    if (v <= min) {
      idx = 0;
    } else if (v >= max) {
      idx = lastBin;
    } else {
      idx = Math.floor(((v - min) / range) * binCount);
      // Defensive clamp against floating point drift.
      if (idx < 0) idx = 0;
      else if (idx > lastBin) idx = lastBin;
    }
    bins[idx] += 1;
  }

  return { bins, min, max };
}

/**
 * Normalize a histogram into a probability density function.
 *
 * The returned array sums to 1.0 (within floating point error). If the
 * histogram has zero total mass, a uniform distribution (1 / binCount per
 * bin) is returned so downstream consumers never see NaN or division by zero.
 */
export function normalize(hist: Histogram): Float64Array {
  const { bins } = hist;
  const n = bins.length;
  const out = new Float64Array(n);

  let total = 0;
  for (let i = 0; i < n; i++) total += bins[i];

  if (total <= 0) {
    const uniform = 1 / n;
    for (let i = 0; i < n; i++) out[i] = uniform;
    return out;
  }

  const inv = 1 / total;
  for (let i = 0; i < n; i++) out[i] = bins[i] * inv;
  return out;
}

/**
 * Build the cumulative distribution function for a histogram.
 *
 * The result is monotonically non-decreasing, with the last entry forced to
 * exactly `1.0` (subject to histogram having any mass; an empty histogram
 * yields a uniform CDF via {@link normalize}).
 */
export function cumulativeDistribution(hist: Histogram): Float64Array {
  const pdf = normalize(hist);
  const n = pdf.length;
  const cdf = new Float64Array(n);

  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += pdf[i];
    cdf[i] = acc;
  }
  // Pin the last entry to exactly 1.0 to defeat accumulated floating drift.
  if (n > 0) cdf[n - 1] = 1.0;
  return cdf;
}

/**
 * Average a non-empty list of CDFs of identical length.
 *
 * Floating point drift may cause the per-bin mean to dip slightly below the
 * previous value; we clamp the result to be monotonic non-decreasing and pin
 * the final entry to 1.0.
 *
 * @throws if `cdfs` is empty or its members differ in length.
 */
export function averageCdfs(cdfs: readonly Float64Array[]): Float64Array {
  if (cdfs.length === 0) {
    throw new Error("averageCdfs: at least one CDF is required");
  }
  const n = cdfs[0].length;
  for (let k = 1; k < cdfs.length; k++) {
    if (cdfs[k].length !== n) {
      throw new Error(
        `averageCdfs: length mismatch at index ${k} (expected ${n}, got ${cdfs[k].length})`,
      );
    }
  }

  const out = new Float64Array(n);
  const inv = 1 / cdfs.length;
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = 0; k < cdfs.length; k++) sum += cdfs[k][i];
    out[i] = sum * inv;
  }

  // Enforce monotonic non-decreasing under floating drift.
  for (let i = 1; i < n; i++) {
    if (out[i] < out[i - 1]) out[i] = out[i - 1];
  }
  if (n > 0) out[n - 1] = 1.0;
  return out;
}

/**
 * 1D Earth Mover's Distance between two CDFs.
 *
 * For 1D distributions defined on the same support, EMD is the L1 distance
 * between the CDFs; here we return the *mean* absolute difference per bin so
 * results are comparable across different bin counts.
 *
 * @throws if the two CDFs differ in length.
 */
export function earthMoverDistance(cdfA: Float64Array, cdfB: Float64Array): number {
  if (cdfA.length !== cdfB.length) {
    throw new Error(
      `earthMoverDistance: length mismatch (${cdfA.length} vs ${cdfB.length})`,
    );
  }
  const n = cdfA.length;
  if (n === 0) return 0;

  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.abs(cdfA[i] - cdfB[i]);
  return sum / n;
}

/**
 * Linearly interpolated CDF lookup for a continuous input value.
 *
 * `value` is clamped to `[min, max]`, then mapped to a fractional bin index
 * and interpolated between adjacent CDF entries. Output is in `[0, 1]`.
 *
 * @throws if `cdf` is empty or `max <= min`.
 */
export function cdfLookup(
  cdf: Float64Array,
  value: number,
  min: number,
  max: number,
): number {
  const n = cdf.length;
  if (n === 0) {
    throw new Error("cdfLookup: cdf is empty");
  }
  if (!(max > min)) {
    throw new Error(`cdfLookup: max (${max}) must be greater than min (${min})`);
  }

  if (value <= min) return cdf[0];
  if (value >= max) return cdf[n - 1];

  // Map value to a continuous bin position in [0, n).
  const pos = ((value - min) / (max - min)) * n;
  // Treat the CDF sample as the value at the *right edge* of each bin, so bin
  // i corresponds to position i+1. We therefore interpolate by integer index
  // shifted by one. Equivalently: bin i covers position [i, i+1].
  let i0 = Math.floor(pos) - 1;
  let i1 = i0 + 1;
  let t = pos - Math.floor(pos);
  if (i0 < 0) {
    // Below the first bin's right edge: ramp linearly from 0 up to cdf[0].
    i0 = 0;
    i1 = 0;
    // Interpolate between an implicit 0 at position 0 and cdf[0] at position 1.
    return pos * cdf[0];
  }
  if (i1 > n - 1) {
    i1 = n - 1;
    i0 = n - 1;
    t = 0;
  }
  return cdf[i0] * (1 - t) + cdf[i1] * t;
}

/**
 * Classic histogram matching for a single value.
 *
 * Look up `sourceCdf(value)` to get a probability `p`, then find the value in
 * the target distribution whose CDF equals `p` (linear interpolation between
 * adjacent target bins). The returned value lies within `[min, max]`.
 *
 * Both CDFs must be defined over the same `[min, max]` support. If their
 * lengths differ, behaviour is still well-defined: source determines `p` and
 * target is searched independently.
 *
 * @throws if either CDF is empty or `max <= min`.
 */
export function histogramMatch(
  value: number,
  sourceCdf: Float64Array,
  targetCdf: Float64Array,
  min: number,
  max: number,
): number {
  if (sourceCdf.length === 0 || targetCdf.length === 0) {
    throw new Error("histogramMatch: CDFs must be non-empty");
  }
  if (!(max > min)) {
    throw new Error(`histogramMatch: max (${max}) must be greater than min (${min})`);
  }

  const p = cdfLookup(sourceCdf, value, min, max);
  return invertCdf(targetCdf, p, min, max);
}

/**
 * Invert a CDF: given a probability in `[0, 1]`, return the value in
 * `[min, max]` whose CDF equals `p`. Linear interpolation is used between
 * adjacent bins. Exported only via {@link histogramMatch} but factored out
 * here for clarity.
 */
function invertCdf(cdf: Float64Array, p: number, min: number, max: number): number {
  const n = cdf.length;
  const range = max - min;

  if (p <= 0) return min;
  if (p >= 1) return max;

  // Find the first bin whose CDF >= p via binary search.
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cdf[mid] < p) lo = mid + 1;
    else hi = mid;
  }
  const idx = lo;

  // Each cdf[i] sits at the right edge of bin i, i.e. at position (i + 1) / n
  // along the [min, max] axis. Interpolate between the previous edge value
  // (either cdf[idx - 1] or 0 if idx === 0) and cdf[idx].
  const prevCdf = idx === 0 ? 0 : cdf[idx - 1];
  const currCdf = cdf[idx];

  let frac: number;
  if (currCdf === prevCdf) {
    // Flat region — collapse to the right edge of this bin.
    frac = 1;
  } else {
    frac = (p - prevCdf) / (currCdf - prevCdf);
  }

  // Position within [0, n] then mapped onto [min, max].
  const pos = idx + frac;
  return min + (pos / n) * range;
}
