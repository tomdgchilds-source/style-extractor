import { describe, it, expect } from "vitest";

import {
  hsvToSrgb,
  labToSrgb,
  linearToSrgb,
  relativeLuminance,
  srgbToHsv,
  srgbToLab,
  srgbToLinear,
} from "../client/src/lib/colorspace";
import type { RGB } from "../client/src/lib/types";

const SAMPLE_COUNT = 100;
const ROUND_TRIP_TOLERANCE = 1.5;

function makeSeededRandom(seed: number): () => number {
  // Mulberry32: small, deterministic PRNG so the test is reproducible.
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomRgbSample(rng: () => number): RGB {
  return [
    Math.round(rng() * 255),
    Math.round(rng() * 255),
    Math.round(rng() * 255),
  ] as const;
}

function maxChannelError(a: RGB, b: RGB): number {
  return Math.max(
    Math.abs(a[0] - b[0]),
    Math.abs(a[1] - b[1]),
    Math.abs(a[2] - b[2]),
  );
}

describe("sRGB transfer function", () => {
  it("srgbToLinear and linearToSrgb are inverses on [0, 1]", () => {
    for (let i = 0; i <= 20; i += 1) {
      const v = i / 20;
      const round = linearToSrgb(srgbToLinear(v));
      expect(Math.abs(round - v)).toBeLessThan(1e-9);
    }
  });

  it("srgbToLinear maps endpoints correctly", () => {
    expect(srgbToLinear(0)).toBeCloseTo(0, 12);
    expect(srgbToLinear(1)).toBeCloseTo(1, 12);
  });

  it("linearToSrgb maps endpoints correctly", () => {
    expect(linearToSrgb(0)).toBeCloseTo(0, 12);
    expect(linearToSrgb(1)).toBeCloseTo(1, 12);
  });
});

describe("relativeLuminance", () => {
  it("is ~1 for pure white", () => {
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 6);
  });

  it("is ~0 for pure black", () => {
    expect(relativeLuminance([0, 0, 0])).toBeCloseTo(0, 6);
  });

  it("matches the canonical luminance coefficients for primaries", () => {
    expect(relativeLuminance([255, 0, 0])).toBeCloseTo(0.2126, 4);
    expect(relativeLuminance([0, 255, 0])).toBeCloseTo(0.7152, 4);
    expect(relativeLuminance([0, 0, 255])).toBeCloseTo(0.0722, 4);
  });
});

describe("srgbToLab / labToSrgb", () => {
  it("white maps to L=100, a=0, b=0", () => {
    const [L, a, b] = srgbToLab([255, 255, 255]);
    expect(L).toBeCloseTo(100, 1);
    expect(Math.abs(a)).toBeLessThan(0.5);
    expect(Math.abs(b)).toBeLessThan(0.5);
  });

  it("black maps to L=0, a=0, b=0", () => {
    const [L, a, b] = srgbToLab([0, 0, 0]);
    expect(L).toBeCloseTo(0, 6);
    expect(a).toBeCloseTo(0, 6);
    expect(b).toBeCloseTo(0, 6);
  });

  it("pure red maps to roughly (53, 80, 67)", () => {
    const [L, a, b] = srgbToLab([255, 0, 0]);
    expect(Math.abs(L - 53)).toBeLessThan(1.5);
    expect(Math.abs(a - 80)).toBeLessThan(1.5);
    expect(Math.abs(b - 67)).toBeLessThan(1.5);
  });

  it("round-trips 100 random RGB values within tolerance", () => {
    const rng = makeSeededRandom(0xc0ffee);
    let worst = 0;
    for (let i = 0; i < SAMPLE_COUNT; i += 1) {
      const rgb = randomRgbSample(rng);
      const back = labToSrgb(srgbToLab(rgb));
      const rounded: RGB = [Math.round(back[0]), Math.round(back[1]), Math.round(back[2])] as const;
      const err = maxChannelError(rgb, rounded);
      if (err > worst) worst = err;
    }
    expect(worst).toBeLessThan(ROUND_TRIP_TOLERANCE);
  });

  it("clamps out-of-gamut LAB inputs into [0, 255]", () => {
    const [r, g, b] = labToSrgb([50, 200, -200]);
    for (const c of [r, g, b]) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(255);
    }
  });
});

describe("srgbToHsv / hsvToSrgb", () => {
  it("pure red is HSV (0, 1, 1)", () => {
    const [h, s, v] = srgbToHsv([255, 0, 0]);
    expect(Math.abs(h - 0)).toBeLessThan(0.01);
    expect(Math.abs(s - 1)).toBeLessThan(0.01);
    expect(Math.abs(v - 1)).toBeLessThan(0.01);
  });

  it("pure green is HSV (120, 1, 1)", () => {
    const [h, s, v] = srgbToHsv([0, 255, 0]);
    expect(Math.abs(h - 120)).toBeLessThan(0.01);
    expect(Math.abs(s - 1)).toBeLessThan(0.01);
    expect(Math.abs(v - 1)).toBeLessThan(0.01);
  });

  it("pure blue is HSV (240, 1, 1)", () => {
    const [h, s, v] = srgbToHsv([0, 0, 255]);
    expect(Math.abs(h - 240)).toBeLessThan(0.01);
    expect(Math.abs(s - 1)).toBeLessThan(0.01);
    expect(Math.abs(v - 1)).toBeLessThan(0.01);
  });

  it("pure greys have saturation 0", () => {
    for (const level of [0, 32, 64, 128, 200, 255]) {
      const [, s] = srgbToHsv([level, level, level]);
      expect(s).toBeCloseTo(0, 12);
    }
  });

  it("round-trips 100 random RGB values within tolerance", () => {
    const rng = makeSeededRandom(0xbadbabe);
    let worst = 0;
    for (let i = 0; i < SAMPLE_COUNT; i += 1) {
      const rgb = randomRgbSample(rng);
      const back = hsvToSrgb(srgbToHsv(rgb));
      const rounded: RGB = [Math.round(back[0]), Math.round(back[1]), Math.round(back[2])] as const;
      const err = maxChannelError(rgb, rounded);
      if (err > worst) worst = err;
    }
    expect(worst).toBeLessThan(ROUND_TRIP_TOLERANCE);
  });

  it("normalizes hue inputs outside [0, 360)", () => {
    const a = hsvToSrgb([0, 1, 1]);
    const b = hsvToSrgb([360, 1, 1]);
    const c = hsvToSrgb([-360, 1, 1]);
    expect(maxChannelError(a, b)).toBeLessThan(1);
    expect(maxChannelError(a, c)).toBeLessThan(1);
  });
});
