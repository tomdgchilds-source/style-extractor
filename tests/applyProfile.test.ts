import { describe, expect, it } from "vitest";

import { applyProfileToRgb01 } from "../client/src/lib/applyProfile";
import { srgbToHsv } from "../client/src/lib/colorspace";
import type { HslAdjustments, Profile } from "../client/src/lib/types";

/**
 * Build a fully zeroed-out {@link Profile} that should be a visual no-op when
 * passed to {@link applyProfileToRgb01}. Intended for test use only.
 */
function identityProfile(overrides: Partial<Profile> = {}): Profile {
  const zeroHsl: HslAdjustments = {
    red: { hue: 0, saturation: 0, luminance: 0 },
    orange: { hue: 0, saturation: 0, luminance: 0 },
    yellow: { hue: 0, saturation: 0, luminance: 0 },
    green: { hue: 0, saturation: 0, luminance: 0 },
    aqua: { hue: 0, saturation: 0, luminance: 0 },
    blue: { hue: 0, saturation: 0, luminance: 0 },
    purple: { hue: 0, saturation: 0, luminance: 0 },
    magenta: { hue: 0, saturation: 0, luminance: 0 },
  };

  return {
    name: "Identity",
    createdAt: "2024-01-01T00:00:00.000Z",
    referenceCount: 0,
    basic: {
      exposure: 0,
      contrast: 0,
      highlights: 0,
      shadows: 0,
      whites: 0,
      blacks: 0,
      texture: 0,
      clarity: 0,
      vibrance: 0,
      saturation: 0,
    },
    toneCurve: [
      { input: 0, output: 0 },
      { input: 1, output: 1 },
    ],
    hsl: zeroHsl,
    colorGrading: {
      shadows: { hue: 0, saturation: 0, luminance: 0 },
      midtones: { hue: 0, saturation: 0, luminance: 0 },
      highlights: { hue: 0, saturation: 0, luminance: 0 },
      global: { hue: 0, saturation: 0, luminance: 0 },
      blending: 0,
      balance: 0,
    },
    grain: { amount: 0, size: 0, roughness: 0 },
    vignette: { amount: 0, midpoint: 0, feather: 0 },
    ...overrides,
  };
}

const PER_CHANNEL_TOL = 0.01;

function expectClose(
  actual: readonly [number, number, number],
  expected: readonly [number, number, number],
  tol: number,
  label: string,
): void {
  for (let i = 0; i < 3; i += 1) {
    expect(
      Math.abs(actual[i] - expected[i]),
      `${label} channel ${i}: got ${actual[i]}, expected ${expected[i]}`,
    ).toBeLessThanOrEqual(tol);
  }
}

describe("applyProfileToRgb01", () => {
  it("identity profile leaves a mid-grey pixel essentially unchanged", () => {
    const out = applyProfileToRgb01([0.5, 0.5, 0.5], identityProfile());
    expectClose(out, [0.5, 0.5, 0.5], PER_CHANNEL_TOL, "mid-grey identity");
  });

  it("identity profile leaves a coloured pixel essentially unchanged", () => {
    const inputs: [number, number, number][] = [
      [0.8, 0.2, 0.3],
      [0.1, 0.7, 0.4],
      [0.4, 0.3, 0.9],
      [0.9, 0.9, 0.2],
    ];
    const profile = identityProfile();
    for (const input of inputs) {
      const out = applyProfileToRgb01(input, profile);
      expectClose(out, input, PER_CHANNEL_TOL, `identity ${JSON.stringify(input)}`);
    }
  });

  it("a tone curve mapping 0.5 -> 0.7 brightens midtones", () => {
    const profile = identityProfile({
      toneCurve: [
        { input: 0, output: 0 },
        { input: 0.5, output: 0.7 },
        { input: 1, output: 1 },
      ],
    });
    const out = applyProfileToRgb01([0.5, 0.5, 0.5], profile);
    // V=0.5 should map to ~0.7 — for a neutral grey, that means each channel
    // also moves toward 0.7.
    expect(out[0]).toBeGreaterThan(0.6);
    expect(out[0]).toBeLessThanOrEqual(1);
    expect(out[1]).toBeGreaterThan(0.6);
    expect(out[2]).toBeGreaterThan(0.6);
    // Should be close to 0.7 for a neutral.
    expectClose(out, [0.7, 0.7, 0.7], 0.05, "tone curve brighten");
  });

  it("a tone curve mapping 0.5 -> 0.3 darkens midtones", () => {
    const profile = identityProfile({
      toneCurve: [
        { input: 0, output: 0 },
        { input: 0.5, output: 0.3 },
        { input: 1, output: 1 },
      ],
    });
    const out = applyProfileToRgb01([0.5, 0.5, 0.5], profile);
    expect(out[0]).toBeLessThan(0.4);
    expect(out[1]).toBeLessThan(0.4);
    expect(out[2]).toBeLessThan(0.4);
  });

  it("saturation = 1.0 increases saturation of a coloured input", () => {
    const profile = identityProfile({
      basic: {
        exposure: 0,
        contrast: 0,
        highlights: 0,
        shadows: 0,
        whites: 0,
        blacks: 0,
        texture: 0,
        clarity: 0,
        vibrance: 0,
        saturation: 1.0,
      },
    });

    const input: [number, number, number] = [0.6, 0.4, 0.4];
    const inHsv = srgbToHsv([input[0] * 255, input[1] * 255, input[2] * 255]);

    const out = applyProfileToRgb01(input, profile);
    const outHsv = srgbToHsv([out[0] * 255, out[1] * 255, out[2] * 255]);

    expect(outHsv[1]).toBeGreaterThan(inHsv[1]);
  });

  it("vibrance boosts low-saturation pixels proportionally more than high-saturation ones", () => {
    const profileVib = identityProfile({
      basic: {
        exposure: 0,
        contrast: 0,
        highlights: 0,
        shadows: 0,
        whites: 0,
        blacks: 0,
        texture: 0,
        clarity: 0,
        vibrance: 1.0,
        saturation: 0,
      },
    });

    const lowSat: [number, number, number] = [0.55, 0.5, 0.5];
    const highSat: [number, number, number] = [0.9, 0.1, 0.1];

    const lowIn = srgbToHsv([lowSat[0] * 255, lowSat[1] * 255, lowSat[2] * 255]);
    const highIn = srgbToHsv([highSat[0] * 255, highSat[1] * 255, highSat[2] * 255]);

    const lowOutRgb = applyProfileToRgb01(lowSat, profileVib);
    const highOutRgb = applyProfileToRgb01(highSat, profileVib);

    const lowOut = srgbToHsv([lowOutRgb[0] * 255, lowOutRgb[1] * 255, lowOutRgb[2] * 255]);
    const highOut = srgbToHsv([highOutRgb[0] * 255, highOutRgb[1] * 255, highOutRgb[2] * 255]);

    // Ratio captures the "more boost where there's less saturation" property
    // of the vibrance formula s * (1 + vibrance * (1 - s)).
    const lowRatio = lowIn[1] > 0 ? lowOut[1] / lowIn[1] : 1;
    const highRatio = highIn[1] > 0 ? highOut[1] / highIn[1] : 1;

    expect(lowRatio).toBeGreaterThan(highRatio);
    // Both should be increases (or at least not decreases).
    expect(lowOut[1]).toBeGreaterThanOrEqual(lowIn[1]);
    expect(highOut[1]).toBeGreaterThanOrEqual(highIn[1]);
  });

  it("pure black input stays black", () => {
    const out = applyProfileToRgb01([0, 0, 0], identityProfile());
    expectClose(out, [0, 0, 0], PER_CHANNEL_TOL, "black");
  });

  it("pure white input stays close to white", () => {
    const out = applyProfileToRgb01([1, 1, 1], identityProfile());
    expectClose(out, [1, 1, 1], PER_CHANNEL_TOL, "white");
  });

  it("clamps output to [0, 1] under aggressive settings", () => {
    const profile = identityProfile({
      toneCurve: [
        { input: 0, output: 0 },
        { input: 0.5, output: 1 },
        { input: 1, output: 1 },
      ],
      basic: {
        exposure: 0,
        contrast: 0,
        highlights: 0,
        shadows: 0,
        whites: 0,
        blacks: 0,
        texture: 0,
        clarity: 0,
        vibrance: 1,
        saturation: 1,
      },
    });
    const out = applyProfileToRgb01([0.9, 0.1, 0.1], profile);
    for (let i = 0; i < 3; i += 1) {
      expect(out[i]).toBeGreaterThanOrEqual(0);
      expect(out[i]).toBeLessThanOrEqual(1);
    }
  });
});
