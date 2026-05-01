import { describe, it, expect } from "vitest";

import {
  averageInLBand,
  averageSaturation,
  cornerCenterLuminanceRatio,
  estimateNoiseLevel,
  midFrequencyContrast,
  rmsContrast,
} from "../client/src/lib/statistics";

/**
 * Mulberry32 — small deterministic PRNG seeded with a 32-bit integer.
 * Used so the random tests run identically every invocation.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Box-Muller transform on a uniform PRNG: returns standard normal samples.
 */
function gaussian(rand: () => number): () => number {
  let spare: number | null = null;
  return function next(): number {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u1 = 0;
    let u2 = 0;
    while (u1 === 0) u1 = rand();
    while (u2 === 0) u2 = rand();
    const mag = Math.sqrt(-2 * Math.log(u1));
    const z0 = mag * Math.cos(2 * Math.PI * u2);
    const z1 = mag * Math.sin(2 * Math.PI * u2);
    spare = z1;
    return z0;
  };
}

describe("rmsContrast", () => {
  it("returns 0 for a constant array", () => {
    expect(rmsContrast([0.5, 0.5, 0.5, 0.5])).toBe(0);
  });

  it("returns 0.5 for [0, 1]", () => {
    expect(rmsContrast([0, 1])).toBeCloseTo(0.5, 12);
  });

  it("returns 0 for an empty input", () => {
    expect(rmsContrast([])).toBe(0);
  });

  it("matches the population standard deviation formula", () => {
    const values = [0.1, 0.3, 0.4, 0.7, 0.9];
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance =
      values.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / values.length;
    const expected = Math.sqrt(variance);
    expect(rmsContrast(values)).toBeCloseTo(expected, 12);
  });
});

describe("averageSaturation", () => {
  it("returns the arithmetic mean", () => {
    expect(averageSaturation([0.2, 0.4, 0.6])).toBeCloseTo(0.4, 12);
  });

  it("returns 0 for an empty input", () => {
    expect(averageSaturation([])).toBe(0);
  });

  it("works with Float64Array inputs", () => {
    const arr = new Float64Array([0, 0.25, 0.5, 0.75, 1]);
    expect(averageSaturation(arr)).toBeCloseTo(0.5, 12);
  });
});

describe("cornerCenterLuminanceRatio", () => {
  it("returns ~1.0 for a uniform image", () => {
    const W = 64;
    const H = 64;
    const lum = new Float64Array(W * H).fill(0.5);
    expect(cornerCenterLuminanceRatio(lum, W, H)).toBeCloseTo(1.0, 12);
  });

  it("returns < 1.0 for an image with darker corners (radial vignette)", () => {
    const W = 128;
    const H = 96;
    const lum = new Float64Array(W * H);
    const cx = (W - 1) / 2;
    const cy = (H - 1) / 2;
    const maxR = Math.hypot(cx, cy);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const r = Math.hypot(dx, dy);
        // Smooth radial darkening: full brightness at centre, ~0 at corners.
        lum[y * W + x] = 1 - r / maxR;
      }
    }
    const ratio = cornerCenterLuminanceRatio(lum, W, H);
    expect(ratio).toBeLessThan(1.0);
    // Sanity: corners should be meaningfully darker than centre.
    expect(ratio).toBeLessThan(0.9);
  });

  it("returns > 1.0 for an image with brighter corners", () => {
    const W = 64;
    const H = 64;
    const lum = new Float64Array(W * H);
    const cx = (W - 1) / 2;
    const cy = (H - 1) / 2;
    const maxR = Math.hypot(cx, cy);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const r = Math.hypot(x - cx, y - cy);
        lum[y * W + x] = r / maxR; // dark centre, bright corners
      }
    }
    expect(cornerCenterLuminanceRatio(lum, W, H)).toBeGreaterThan(1.0);
  });

  it("returns 1.0 for degenerate dimensions", () => {
    expect(cornerCenterLuminanceRatio(new Float64Array(0), 0, 0)).toBe(1.0);
  });
});

describe("estimateNoiseLevel", () => {
  it("returns ~0 for a uniform image", () => {
    const W = 32;
    const H = 32;
    const lum = new Float64Array(W * H).fill(0.5);
    expect(estimateNoiseLevel(lum, W, H)).toBeCloseTo(0, 12);
  });

  it("recovers the noise stddev (within 50%) for uniform + Gaussian noise", () => {
    const W = 64;
    const H = 64;
    const sigma = 0.02;
    const rand = mulberry32(0xc0ffee);
    const norm = gaussian(rand);

    const lum = new Float64Array(W * H);
    for (let i = 0; i < lum.length; i++) {
      lum[i] = 0.5 + norm() * sigma;
    }
    const est = estimateNoiseLevel(lum, W, H);
    // Within 50% of true stddev.
    expect(est).toBeGreaterThan(sigma * 0.5);
    expect(est).toBeLessThan(sigma * 1.5);
  });

  it("returns 0 for images smaller than 3x3", () => {
    expect(estimateNoiseLevel(new Float64Array(4), 2, 2)).toBe(0);
    expect(estimateNoiseLevel(new Float64Array(0), 0, 0)).toBe(0);
  });
});

describe("midFrequencyContrast", () => {
  it("returns ~0 for a uniform image", () => {
    const W = 32;
    const H = 32;
    const lum = new Float64Array(W * H).fill(0.5);
    expect(midFrequencyContrast(lum, W, H)).toBeCloseTo(0, 12);
  });

  it("returns > 0 for a 1-pixel checkerboard", () => {
    const W = 32;
    const H = 32;
    const lum = new Float64Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        lum[y * W + x] = (x + y) % 2 === 0 ? 1 : 0;
      }
    }
    expect(midFrequencyContrast(lum, W, H)).toBeGreaterThan(0);
  });

  it("returns 0 for images smaller than 7x7", () => {
    expect(midFrequencyContrast(new Float64Array(36), 6, 6)).toBe(0);
  });
});

describe("averageInLBand", () => {
  it("filters by L range and returns the mean of values in band", () => {
    const values = [10, 20, 30, 40, 50];
    const lValues = [0.1, 0.3, 0.5, 0.7, 0.9];
    // Band [0.3, 0.8) selects indices 1, 2, 3 -> values 20, 30, 40 -> mean 30.
    expect(averageInLBand(values, lValues, 0.3, 0.8)).toBeCloseTo(30, 12);
  });

  it("uses half-open interval [lMin, lMax)", () => {
    const values = [1, 2, 3];
    const lValues = [0.0, 0.5, 1.0];
    // L of 1.0 is excluded by lMax = 1.0.
    expect(averageInLBand(values, lValues, 0.0, 1.0)).toBeCloseTo(1.5, 12);
    // L of 0.0 is included by lMin = 0.0.
    expect(averageInLBand(values, lValues, 0.0, 0.5)).toBeCloseTo(1, 12);
  });

  it("returns 0 if no L values fall in the band", () => {
    const values = [10, 20, 30];
    const lValues = [0.1, 0.2, 0.3];
    expect(averageInLBand(values, lValues, 0.5, 0.6)).toBe(0);
  });

  it("returns 0 for empty inputs", () => {
    expect(averageInLBand([], [], 0, 1)).toBe(0);
  });

  it("works with Float64Array inputs", () => {
    const values = new Float64Array([1, 2, 3, 4]);
    const lValues = new Float64Array([0.0, 0.25, 0.5, 0.75]);
    expect(averageInLBand(values, lValues, 0.25, 0.75)).toBeCloseTo(2.5, 12);
  });
});
