import { describe, expect, it } from "vitest";

import { writeCubeLut, type CubeSize } from "../client/src/lib/cube";
import type { HslAdjustments, Profile } from "../client/src/lib/types";

/** Test-only zeroed profile factory mirrored from applyProfile.test.ts. */
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
    referenceCount: 1,
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

/** Pull only the data lines (i.e. lines that look like three floats). */
function dataLines(cube: string): string[] {
  return cube
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^-?\d+\.\d+(\s+-?\d+\.\d+){2}$/.test(l));
}

function parseLine(line: string): [number, number, number] {
  const parts = line.trim().split(/\s+/).map(Number);
  return [parts[0], parts[1], parts[2]];
}

describe("writeCubeLut", () => {
  it("output contains TITLE and LUT_3D_SIZE on their own lines", () => {
    const cube = writeCubeLut(identityProfile({ name: "Test Profile" }), 17);
    const lines = cube.split("\n");

    expect(lines.some((l) => l.startsWith("TITLE "))).toBe(true);
    expect(lines.some((l) => l === "LUT_3D_SIZE 17")).toBe(true);
    expect(lines.some((l) => l.startsWith("DOMAIN_MIN "))).toBe(true);
    expect(lines.some((l) => l.startsWith("DOMAIN_MAX "))).toBe(true);
  });

  it("title line uses double quotes around the profile name", () => {
    const cube = writeCubeLut(identityProfile({ name: "My Style" }), 17);
    const titleLine = cube.split("\n").find((l) => l.startsWith("TITLE "));
    expect(titleLine).toBe(`TITLE "My Style"`);
  });

  it("strips newlines from the title", () => {
    const cube = writeCubeLut(identityProfile({ name: "Line A\nLine B" }), 17);
    const titleLine = cube.split("\n").find((l) => l.startsWith("TITLE "));
    expect(titleLine).toBeDefined();
    expect(titleLine ?? "").not.toContain("\n");
    // Should have collapsed the newline into a space.
    expect(titleLine).toBe(`TITLE "Line A Line B"`);
  });

  it.each<CubeSize>([17, 25, 33])(
    "data line count equals size^3 for size = %d",
    (size) => {
      const cube = writeCubeLut(identityProfile(), size);
      const data = dataLines(cube);
      expect(data.length).toBe(size * size * size);
    },
  );

  it("each data line has 3 floats separated by spaces", () => {
    const cube = writeCubeLut(identityProfile(), 17);
    const data = dataLines(cube);
    expect(data.length).toBeGreaterThan(0);
    for (const line of data) {
      const parts = line.split(/\s+/);
      expect(parts.length).toBe(3);
      for (const p of parts) {
        expect(Number.isFinite(Number(p))).toBe(true);
      }
    }
  });

  it("identity profile produces a near-identity LUT at the corners", () => {
    const size: CubeSize = 17;
    const cube = writeCubeLut(identityProfile(), size);
    const data = dataLines(cube);

    // Index for (r, g, b) = (0, 0, 0).
    const blackIdx = 0;
    const black = parseLine(data[blackIdx]);
    expect(Math.abs(black[0])).toBeLessThanOrEqual(0.01);
    expect(Math.abs(black[1])).toBeLessThanOrEqual(0.01);
    expect(Math.abs(black[2])).toBeLessThanOrEqual(0.01);

    // Index for (r, g, b) = (size-1, size-1, size-1) — the last grid point.
    const whiteIdx = size * size * size - 1;
    const white = parseLine(data[whiteIdx]);
    expect(Math.abs(white[0] - 1)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(white[1] - 1)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(white[2] - 1)).toBeLessThanOrEqual(0.01);
  });

  it("identity profile is near-identity at every grid point", () => {
    const size: CubeSize = 17;
    const cube = writeCubeLut(identityProfile(), size);
    const data = dataLines(cube);
    const denom = size - 1;

    for (let bi = 0; bi < size; bi += 1) {
      for (let gi = 0; gi < size; gi += 1) {
        for (let ri = 0; ri < size; ri += 1) {
          const idx = bi * size * size + gi * size + ri;
          const [or, og, ob] = parseLine(data[idx]);
          expect(Math.abs(or - ri / denom)).toBeLessThanOrEqual(0.02);
          expect(Math.abs(og - gi / denom)).toBeLessThanOrEqual(0.02);
          expect(Math.abs(ob - bi / denom)).toBeLessThanOrEqual(0.02);
        }
      }
    }
  });

  it("data lines use 6 decimal places", () => {
    const cube = writeCubeLut(identityProfile(), 17);
    const data = dataLines(cube);
    for (const line of data) {
      for (const part of line.split(/\s+/)) {
        const decimals = part.split(".")[1];
        expect(decimals?.length).toBe(6);
      }
    }
  });

  it("includes a header comment with the profile name", () => {
    const cube = writeCubeLut(identityProfile({ name: "Cinematic Warm" }), 17);
    expect(cube).toMatch(/^# /m);
    expect(cube).toMatch(/Cinematic Warm/);
  });
});
