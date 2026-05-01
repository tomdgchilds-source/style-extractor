import { describe, it, expect } from "vitest";
import {
  buildHistogram,
  normalize,
  cumulativeDistribution,
  averageCdfs,
  earthMoverDistance,
  cdfLookup,
  histogramMatch,
} from "../client/src/lib/histogram";

const EPS = 1e-12;

describe("buildHistogram", () => {
  it("places values into the correct bins, with max landing in the last bin", () => {
    const hist = buildHistogram([0, 0.5, 1], 10, 0, 1);
    expect(hist.bins.length).toBe(10);
    expect(hist.bins[0]).toBe(1);
    expect(hist.bins[5]).toBe(1);
    expect(hist.bins[9]).toBe(1);
    // No spurious counts elsewhere.
    let total = 0;
    for (let i = 0; i < hist.bins.length; i++) total += hist.bins[i];
    expect(total).toBe(3);
  });

  it("clamps out-of-range values to the nearest edge bin", () => {
    const hist = buildHistogram([-5, -0.001, 1.001, 999], 10, 0, 1);
    expect(hist.bins[0]).toBe(2);
    expect(hist.bins[9]).toBe(2);
    let mid = 0;
    for (let i = 1; i < 9; i++) mid += hist.bins[i];
    expect(mid).toBe(0);
  });

  it("preserves min and max on the returned histogram", () => {
    const hist = buildHistogram([0.1, 0.2], 4, 0, 1);
    expect(hist.min).toBe(0);
    expect(hist.max).toBe(1);
  });

  it("throws on invalid bin counts and degenerate ranges", () => {
    expect(() => buildHistogram([0.5], 0, 0, 1)).toThrow();
    expect(() => buildHistogram([0.5], -1, 0, 1)).toThrow();
    expect(() => buildHistogram([0.5], 1.5, 0, 1)).toThrow();
    expect(() => buildHistogram([0.5], 4, 1, 1)).toThrow();
    expect(() => buildHistogram([0.5], 4, 1, 0)).toThrow();
  });
});

describe("normalize", () => {
  it("returns a PDF that sums to 1.0", () => {
    const hist = buildHistogram([0, 0.25, 0.5, 0.75, 1], 5, 0, 1);
    const pdf = normalize(hist);
    let total = 0;
    for (let i = 0; i < pdf.length; i++) total += pdf[i];
    expect(Math.abs(total - 1)).toBeLessThan(EPS);
  });

  it("returns a uniform distribution for empty histograms", () => {
    const hist = buildHistogram([], 4, 0, 1);
    const pdf = normalize(hist);
    for (let i = 0; i < pdf.length; i++) {
      expect(pdf[i]).toBeCloseTo(0.25, 12);
    }
  });
});

describe("cumulativeDistribution", () => {
  it("is monotonic non-decreasing and ends at exactly 1.0", () => {
    const hist = buildHistogram(
      [0.05, 0.1, 0.15, 0.4, 0.42, 0.43, 0.9, 0.95],
      16,
      0,
      1,
    );
    const cdf = cumulativeDistribution(hist);
    for (let i = 1; i < cdf.length; i++) {
      expect(cdf[i]).toBeGreaterThanOrEqual(cdf[i - 1]);
    }
    expect(Math.abs(cdf[cdf.length - 1] - 1)).toBeLessThan(EPS);
  });

  it("matches the cumulative sum of a known distribution", () => {
    // Two values per bin: simple uniform.
    const values = [0.1, 0.3, 0.5, 0.7, 0.9];
    const hist = buildHistogram(values, 5, 0, 1);
    const cdf = cumulativeDistribution(hist);
    expect(cdf[0]).toBeCloseTo(0.2, 12);
    expect(cdf[1]).toBeCloseTo(0.4, 12);
    expect(cdf[2]).toBeCloseTo(0.6, 12);
    expect(cdf[3]).toBeCloseTo(0.8, 12);
    expect(cdf[4]).toBeCloseTo(1.0, 12);
  });
});

describe("averageCdfs", () => {
  it("returns the same CDF when averaging duplicates", () => {
    const hist = buildHistogram([0.1, 0.4, 0.4, 0.9], 8, 0, 1);
    const cdf = cumulativeDistribution(hist);
    const avg = averageCdfs([cdf, cdf]);
    expect(avg.length).toBe(cdf.length);
    for (let i = 0; i < cdf.length; i++) {
      expect(Math.abs(avg[i] - cdf[i])).toBeLessThan(EPS);
    }
  });

  it("blends two different CDFs and stays monotonic", () => {
    const a = cumulativeDistribution(buildHistogram([0.05, 0.1, 0.15], 8, 0, 1));
    const b = cumulativeDistribution(buildHistogram([0.85, 0.9, 0.95], 8, 0, 1));
    const avg = averageCdfs([a, b]);
    for (let i = 1; i < avg.length; i++) {
      expect(avg[i]).toBeGreaterThanOrEqual(avg[i - 1]);
    }
    expect(Math.abs(avg[avg.length - 1] - 1)).toBeLessThan(EPS);
  });

  it("throws on empty input or mismatched lengths", () => {
    expect(() => averageCdfs([])).toThrow();
    expect(() =>
      averageCdfs([new Float64Array(4), new Float64Array(5)]),
    ).toThrow();
  });
});

describe("earthMoverDistance", () => {
  it("returns 0 when comparing a CDF to itself", () => {
    const cdf = cumulativeDistribution(
      buildHistogram([0.1, 0.4, 0.7, 0.9], 16, 0, 1),
    );
    expect(earthMoverDistance(cdf, cdf)).toBe(0);
  });

  it("is symmetric", () => {
    const a = cumulativeDistribution(buildHistogram([0.1, 0.2, 0.3], 12, 0, 1));
    const b = cumulativeDistribution(buildHistogram([0.7, 0.8, 0.9], 12, 0, 1));
    const ab = earthMoverDistance(a, b);
    const ba = earthMoverDistance(b, a);
    expect(Math.abs(ab - ba)).toBeLessThan(EPS);
    expect(ab).toBeGreaterThan(0);
  });

  it("throws when CDF lengths differ", () => {
    expect(() =>
      earthMoverDistance(new Float64Array(4), new Float64Array(8)),
    ).toThrow();
  });
});

describe("cdfLookup", () => {
  it("clamps below min to cdf[0] and above max to cdf[last]", () => {
    const cdf = cumulativeDistribution(buildHistogram([0.2, 0.5, 0.8], 8, 0, 1));
    expect(cdfLookup(cdf, -10, 0, 1)).toBe(cdf[0]);
    expect(cdfLookup(cdf, 10, 0, 1)).toBe(cdf[cdf.length - 1]);
  });

  it("returns values within [0, 1] for in-range inputs", () => {
    const cdf = cumulativeDistribution(
      buildHistogram([0.1, 0.3, 0.5, 0.7, 0.9], 16, 0, 1),
    );
    for (const v of [0.0, 0.05, 0.25, 0.5, 0.75, 0.95, 1.0]) {
      const out = cdfLookup(cdf, v, 0, 1);
      expect(out).toBeGreaterThanOrEqual(0);
      expect(out).toBeLessThanOrEqual(1);
    }
  });

  it("throws on empty cdf or degenerate range", () => {
    expect(() => cdfLookup(new Float64Array(0), 0.5, 0, 1)).toThrow();
    const cdf = cumulativeDistribution(buildHistogram([0.5], 4, 0, 1));
    expect(() => cdfLookup(cdf, 0.5, 1, 1)).toThrow();
  });
});

describe("histogramMatch", () => {
  it("round-trips: matching from a (dense) CDF to itself returns the input within one bin width", () => {
    // Dense CDF: 1000 evenly spaced samples ensures no empty bins, so the
    // forward-then-inverse round-trip is unambiguous.
    const binCount = 64;
    const dense: number[] = [];
    for (let i = 0; i < 1000; i++) dense.push((i + 0.5) / 1000);
    const hist = buildHistogram(dense, binCount, 0, 1);
    const cdf = cumulativeDistribution(hist);
    const binWidth = 1 / binCount;

    for (const v of [0.05, 0.2, 0.5, 0.7, 0.95]) {
      const matched = histogramMatch(v, cdf, cdf, 0, 1);
      expect(Math.abs(matched - v)).toBeLessThanOrEqual(binWidth);
    }
  });

  it("with a sparse CDF, round-trip is bounded by the largest empty-bin run", () => {
    // Sparse CDFs (many empty bins) introduce ambiguity in the inverse lookup.
    // Bound the error by the bin width times the longest run of empty bins
    // between two non-empty ones.
    const binCount = 64;
    const sparse = [0.05, 0.1, 0.2, 0.4, 0.45, 0.5, 0.55, 0.7, 0.85, 0.95];
    const hist = buildHistogram(sparse, binCount, 0, 1);
    const cdf = cumulativeDistribution(hist);
    // The biggest empty-bin run in this distribution is between 0.55 and 0.7,
    // which is roughly 0.15 / (1/64) ≈ 9 bin widths apart. Allow 10 to be safe.
    const tolerance = 10 / binCount;

    for (const v of [0.05, 0.2, 0.5, 0.7, 0.95]) {
      const matched = histogramMatch(v, cdf, cdf, 0, 1);
      expect(Math.abs(matched - v)).toBeLessThanOrEqual(tolerance);
    }
  });

  it("shifts a midpoint sensibly between a uniform and a heavily-skewed CDF", () => {
    const binCount = 64;

    // Uniform-ish source: many evenly spaced values.
    const uniformValues: number[] = [];
    for (let i = 0; i < 1000; i++) {
      uniformValues.push((i + 0.5) / 1000);
    }
    const uniformCdf = cumulativeDistribution(
      buildHistogram(uniformValues, binCount, 0, 1),
    );

    // Heavily-skewed target: almost all mass piled into the bottom 20%.
    const skewedValues: number[] = [];
    for (let i = 0; i < 1000; i++) {
      skewedValues.push(Math.random() * 0.2);
    }
    // Make the test deterministic without seeding by replacing with a fixed
    // ramp inside [0, 0.2].
    skewedValues.length = 0;
    for (let i = 0; i < 1000; i++) {
      skewedValues.push((i / 1000) * 0.2);
    }
    const skewedCdf = cumulativeDistribution(
      buildHistogram(skewedValues, binCount, 0, 1),
    );

    // Mapping a midpoint uniform value (0.5) onto a target piled into [0, 0.2]
    // should pull it well below 0.5 — somewhere inside the target's support.
    const matched = histogramMatch(0.5, uniformCdf, skewedCdf, 0, 1);
    expect(matched).toBeLessThan(0.3);
    expect(matched).toBeGreaterThanOrEqual(0);

    // Going the other way pushes a midpoint value way up.
    const matchedBack = histogramMatch(0.1, skewedCdf, uniformCdf, 0, 1);
    expect(matchedBack).toBeGreaterThan(0.3);
    expect(matchedBack).toBeLessThanOrEqual(1);
  });

  it("throws on empty CDFs or degenerate range", () => {
    const cdf = cumulativeDistribution(buildHistogram([0.5], 4, 0, 1));
    expect(() => histogramMatch(0.5, new Float64Array(0), cdf, 0, 1)).toThrow();
    expect(() => histogramMatch(0.5, cdf, new Float64Array(0), 0, 1)).toThrow();
    expect(() => histogramMatch(0.5, cdf, cdf, 1, 1)).toThrow();
  });
});
