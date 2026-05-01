/**
 * Per-image scalar statistics.
 *
 * Each function in this module takes a luminance, saturation, or generic
 * value array (extracted from one reference image's pixel data) and returns
 * a scalar measurement. Downstream code averages these scalars across many
 * reference images to characterise a photographer's style.
 *
 * Inputs are expected in the [0, 1] scale unless otherwise noted, and the
 * outputs are reported in the same scale so they compose cleanly across
 * channels and images.
 */

/**
 * Root-mean-square contrast: the population standard deviation of luminance.
 *
 * Inputs are assumed to be in [0, 1]. Returns 0 for an empty input or a
 * perfectly flat image (every pixel identical).
 */
export function rmsContrast(luminance: ArrayLike<number>): number {
  const n = luminance.length;
  if (n === 0) return 0;

  let sum = 0;
  for (let i = 0; i < n; i++) sum += luminance[i];
  const mean = sum / n;

  let sqSum = 0;
  for (let i = 0; i < n; i++) {
    const d = luminance[i] - mean;
    sqSum += d * d;
  }
  return Math.sqrt(sqSum / n);
}

/**
 * Arithmetic mean of saturation values, expected in [0, 1].
 *
 * Returns 0 for an empty input.
 */
export function averageSaturation(saturation: ArrayLike<number>): number {
  const n = saturation.length;
  if (n === 0) return 0;

  let sum = 0;
  for (let i = 0; i < n; i++) sum += saturation[i];
  return sum / n;
}

/**
 * Ratio of mean luminance in the corner band (outer 25% by area) to mean
 * luminance in the central 25% (centre rectangle whose area equals 25% of
 * the total).
 *
 * - 1.0 indicates no vignette,
 * - < 1.0 indicates darker corners,
 * - > 1.0 indicates brighter corners.
 *
 * The corner band is defined as every pixel outside the centred rectangle
 * whose area is 75% of the image (so the band itself accounts for the
 * remaining 25%). The central region is the centred rectangle whose area
 * is 25% of the image. Both rectangles preserve the image aspect ratio.
 *
 * Returns 1.0 if either region is empty (degenerate image dimensions).
 */
export function cornerCenterLuminanceRatio(
  luminance: ArrayLike<number>,
  width: number,
  height: number,
): number {
  if (width <= 0 || height <= 0 || luminance.length === 0) return 1.0;

  // Inner rectangle of area 0.75 * total (preserving aspect ratio):
  //   innerW = width  * sqrt(0.75)
  //   innerH = height * sqrt(0.75)
  // Pixels outside this rectangle form the outer 25%-by-area corner band.
  const innerScale = Math.sqrt(0.75);
  const innerW = width * innerScale;
  const innerH = height * innerScale;
  const innerX0 = (width - innerW) / 2;
  const innerY0 = (height - innerH) / 2;
  const innerX1 = innerX0 + innerW;
  const innerY1 = innerY0 + innerH;

  // Centre rectangle of area 0.25 * total (preserving aspect ratio):
  //   centerW = width  * sqrt(0.25) = width  / 2
  //   centerH = height * sqrt(0.25) = height / 2
  const centerScale = Math.sqrt(0.25);
  const centerW = width * centerScale;
  const centerH = height * centerScale;
  const centerX0 = (width - centerW) / 2;
  const centerY0 = (height - centerH) / 2;
  const centerX1 = centerX0 + centerW;
  const centerY1 = centerY0 + centerH;

  let cornerSum = 0;
  let cornerCount = 0;
  let centerSum = 0;
  let centerCount = 0;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    // Pixel centre is at (x + 0.5, y + 0.5).
    const py = y + 0.5;
    const inInnerRow = py >= innerY0 && py < innerY1;
    const inCenterRow = py >= centerY0 && py < centerY1;
    for (let x = 0; x < width; x++) {
      const v = luminance[rowOffset + x];
      const px = x + 0.5;

      const inInner = inInnerRow && px >= innerX0 && px < innerX1;
      if (!inInner) {
        cornerSum += v;
        cornerCount++;
      }

      const inCenter = inCenterRow && px >= centerX0 && px < centerX1;
      if (inCenter) {
        centerSum += v;
        centerCount++;
      }
    }
  }

  if (cornerCount === 0 || centerCount === 0) return 1.0;
  const cornerMean = cornerSum / cornerCount;
  const centerMean = centerSum / centerCount;
  if (centerMean === 0) return 1.0;
  return cornerMean / centerMean;
}

/**
 * Estimate per-pixel noise level by combining a Laplacian high-pass with a
 * flat-region mask.
 *
 * Algorithm:
 *   1. Apply a 3x3 Laplacian kernel (centre +4, four-neighbours -1, corners 0)
 *      to every interior pixel.
 *   2. For the same interior pixels, compute the local 3x3 luminance variance.
 *   3. Take the 25th percentile of the variance distribution to define the
 *      "flat" set: pixels whose 3x3 variance is in the bottom 25%.
 *   4. Return the median absolute Laplacian response over that flat set,
 *      which approximates the noise standard deviation in luminance units.
 *
 * Output is on the same [0, 1] scale as the input luminance. Returns 0 for
 * images smaller than 3x3 or perfectly flat inputs.
 */
export function estimateNoiseLevel(
  luminance: ArrayLike<number>,
  width: number,
  height: number,
): number {
  if (width < 3 || height < 3) return 0;
  const interiorW = width - 2;
  const interiorH = height - 2;
  const interiorN = interiorW * interiorH;
  if (interiorN <= 0) return 0;

  const lap = new Float64Array(interiorN);
  const variance = new Float64Array(interiorN);

  for (let y = 1; y < height - 1; y++) {
    const rowOffset = y * width;
    const upOffset = rowOffset - width;
    const dnOffset = rowOffset + width;
    const outRowOffset = (y - 1) * interiorW;
    for (let x = 1; x < width - 1; x++) {
      const c = luminance[rowOffset + x];
      const n = luminance[upOffset + x];
      const s = luminance[dnOffset + x];
      const w = luminance[rowOffset + x - 1];
      const e = luminance[rowOffset + x + 1];
      const nw = luminance[upOffset + x - 1];
      const ne = luminance[upOffset + x + 1];
      const sw = luminance[dnOffset + x - 1];
      const se = luminance[dnOffset + x + 1];

      // 3x3 Laplacian (4-neighbour form). Magnitude of |4c - n - s - w - e|.
      const lapValue = 4 * c - n - s - w - e;

      // 3x3 local variance (population variance over 9 samples).
      const sum = c + n + s + w + e + nw + ne + sw + se;
      const mean = sum / 9;
      const dC = c - mean;
      const dN = n - mean;
      const dS = s - mean;
      const dW = w - mean;
      const dE = e - mean;
      const dNW = nw - mean;
      const dNE = ne - mean;
      const dSW = sw - mean;
      const dSE = se - mean;
      const varValue =
        (dC * dC +
          dN * dN +
          dS * dS +
          dW * dW +
          dE * dE +
          dNW * dNW +
          dNE * dNE +
          dSW * dSW +
          dSE * dSE) /
        9;

      const idx = outRowOffset + (x - 1);
      lap[idx] = Math.abs(lapValue);
      variance[idx] = varValue;
    }
  }

  // 25th percentile of variance defines the flat set.
  const varianceCopy = new Float64Array(variance);
  const flatThreshold = quickSelectQuantile(varianceCopy, 0.25);

  // Collect absolute Laplacian responses in the flat set.
  const flat = new Float64Array(interiorN);
  let flatCount = 0;
  for (let i = 0; i < interiorN; i++) {
    if (variance[i] <= flatThreshold) {
      flat[flatCount++] = lap[i];
    }
  }
  if (flatCount === 0) return 0;

  // Median of the flat-set absolute Laplacian responses.
  const flatTrimmed = flat.subarray(0, flatCount);
  const medianAbsLap = quickSelectQuantile(flatTrimmed, 0.5);

  // The 3x3 four-neighbour Laplacian on i.i.d. zero-mean noise with stddev s
  // produces output with stddev s * sqrt(20). The expected magnitude of a
  // Gaussian is sqrt(2/pi) * stddev, but the median absolute value is
  // approximately 0.6745 * stddev. We invert that scaling so the returned
  // value tracks the input noise stddev.
  const LAPLACIAN_STDDEV_SCALE = Math.sqrt(20);
  const MEDIAN_ABS_TO_STDDEV = 1 / 0.6745;
  return (medianAbsLap * MEDIAN_ABS_TO_STDDEV) / LAPLACIAN_STDDEV_SCALE;
}

/**
 * Mid-frequency contrast: RMS magnitude of a difference-of-box-blurs bandpass.
 *
 * Computes (boxBlur radius 3) - (boxBlur radius 1) per pixel and returns the
 * root-mean-square of the per-pixel difference. This isolates spatial
 * frequencies between roughly 1- and 3-pixel scales — the band a "Clarity"
 * style adjustment operates on.
 *
 * Output is on the same [0, 1] scale as the input luminance. Returns 0 for
 * images smaller than 7x7 or perfectly flat inputs.
 */
export function midFrequencyContrast(
  luminance: ArrayLike<number>,
  width: number,
  height: number,
): number {
  // We need at least a 7x7 window for the radius-3 box blur to have any
  // interior pixel without clamping. Below that, return 0.
  if (width < 7 || height < 7) return 0;

  // Compute via summed-area table (one Float64Array allocation, O(N)).
  // sat[(y+1) * (W+1) + (x+1)] = sum of luminance[0..x, 0..y].
  const W1 = width + 1;
  const sat = new Float64Array(W1 * (height + 1));
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    const rowOffset = y * width;
    const satRowOffset = (y + 1) * W1;
    const satPrevRowOffset = y * W1;
    for (let x = 0; x < width; x++) {
      rowSum += luminance[rowOffset + x];
      sat[satRowOffset + (x + 1)] = sat[satPrevRowOffset + (x + 1)] + rowSum;
    }
  }

  // Compute RMS over interior pixels where both radius-3 and radius-1 windows
  // fit (so neither needs clamping). x in [3, width-4], y in [3, height-4].
  let sqSum = 0;
  let count = 0;
  for (let y = 3; y < height - 3; y++) {
    for (let x = 3; x < width - 3; x++) {
      // Radius-3 mean over 7x7 window centred at (x, y).
      const r3x0 = x - 3;
      const r3y0 = y - 3;
      const r3x1 = x + 4;
      const r3y1 = y + 4;
      const sumR3 =
        sat[r3y1 * W1 + r3x1] -
        sat[r3y0 * W1 + r3x1] -
        sat[r3y1 * W1 + r3x0] +
        sat[r3y0 * W1 + r3x0];
      const meanR3 = sumR3 / 49;

      // Radius-1 mean over 3x3 window centred at (x, y).
      const r1x0 = x - 1;
      const r1y0 = y - 1;
      const r1x1 = x + 2;
      const r1y1 = y + 2;
      const sumR1 =
        sat[r1y1 * W1 + r1x1] -
        sat[r1y0 * W1 + r1x1] -
        sat[r1y1 * W1 + r1x0] +
        sat[r1y0 * W1 + r1x0];
      const meanR1 = sumR1 / 9;

      const d = meanR3 - meanR1;
      sqSum += d * d;
      count++;
    }
  }
  if (count === 0) return 0;
  return Math.sqrt(sqSum / count);
}

/**
 * Mean of `values[i]` for all indices where `lMin <= lValues[i] < lMax`.
 *
 * Used to compute the average of a per-pixel quantity (e.g. an a-star or
 * b-star channel value) restricted to a particular luminance band —
 * typically shadows, midtones, or highlights.
 *
 * Returns 0 if no pixel falls in the band, or if the input arrays are
 * empty. The two arrays must be the same length; the loop iterates up to
 * the shorter of the two.
 */
export function averageInLBand(
  values: ArrayLike<number>,
  lValues: ArrayLike<number>,
  lMin: number,
  lMax: number,
): number {
  const n = Math.min(values.length, lValues.length);
  if (n === 0) return 0;

  let sum = 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const l = lValues[i];
    if (l >= lMin && l < lMax) {
      sum += values[i];
      count++;
    }
  }
  if (count === 0) return 0;
  return sum / count;
}

// ---- internal helpers ----

/**
 * Quickselect-based quantile on a Float64Array. Mutates the input by partial
 * partitioning. `q` in [0, 1]; returns the value at the `q`-th rank.
 */
function quickSelectQuantile(arr: Float64Array, q: number): number {
  const n = arr.length;
  if (n === 0) return 0;
  if (n === 1) return arr[0];
  const k = Math.min(n - 1, Math.max(0, Math.floor(q * (n - 1))));
  return quickSelect(arr, 0, n - 1, k);
}

function quickSelect(arr: Float64Array, left: number, right: number, k: number): number {
  while (left < right) {
    // Median-of-three pivot to avoid quadratic behaviour on sorted/uniform
    // inputs (the noise estimator feeds in lots of zeros).
    const mid = (left + right) >> 1;
    if (arr[left] > arr[mid]) swap(arr, left, mid);
    if (arr[left] > arr[right]) swap(arr, left, right);
    if (arr[mid] > arr[right]) swap(arr, mid, right);
    // Move pivot to position `right` and run a Lomuto partition.
    swap(arr, mid, right);
    const pivot = arr[right];

    let store = left;
    for (let i = left; i < right; i++) {
      if (arr[i] < pivot) {
        swap(arr, i, store);
        store++;
      }
    }
    swap(arr, store, right);

    if (store === k) return arr[k];
    if (k < store) right = store - 1;
    else left = store + 1;
  }
  return arr[left];
}

function swap(arr: Float64Array, i: number, j: number): void {
  const tmp = arr[i];
  arr[i] = arr[j];
  arr[j] = tmp;
}
