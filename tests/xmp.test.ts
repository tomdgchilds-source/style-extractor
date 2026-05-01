import { describe, it, expect } from "vitest";

import {
  mapToLightroomScale,
  writeLightroomXmp,
} from "../client/src/lib/xmp";
import type {
  HslAdjustments,
  HslHue,
  Profile,
  ToneCurvePoint,
} from "../client/src/lib/types";

const HSL_HUES: readonly HslHue[] = [
  "red",
  "orange",
  "yellow",
  "green",
  "aqua",
  "blue",
  "purple",
  "magenta",
];

/**
 * Build a complete, well-formed Profile for tests. Callers may override
 * any subset of fields; deep merging is intentionally shallow — pass a
 * complete sub-object when you need to change one of the nested groups.
 */
function samplePreset(overrides: Partial<Profile> = {}): Profile {
  const hslEntries: Record<HslHue, { hue: number; saturation: number; luminance: number }> = {
    red: { hue: 0, saturation: 0, luminance: 0 },
    orange: { hue: 0, saturation: 0, luminance: 0 },
    yellow: { hue: 0, saturation: 0, luminance: 0 },
    green: { hue: 0, saturation: 0, luminance: 0 },
    aqua: { hue: 0, saturation: 0, luminance: 0 },
    blue: { hue: 0, saturation: 0, luminance: 0 },
    purple: { hue: 0, saturation: 0, luminance: 0 },
    magenta: { hue: 0, saturation: 0, luminance: 0 },
  };
  HSL_HUES.forEach((hue, i) => {
    hslEntries[hue] = {
      hue: -0.4 + 0.1 * i,
      saturation: -0.3 + 0.075 * i,
      luminance: -0.2 + 0.05 * i,
    };
  });
  const hsl: HslAdjustments = hslEntries;

  const toneCurve: ToneCurvePoint[] = [
    { input: 0, output: 0 },
    { input: 64, output: 60 },
    { input: 128, output: 130 },
    { input: 192, output: 200 },
    { input: 255, output: 255 },
  ];

  const base: Profile = {
    name: "Sample Preset",
    createdAt: "2026-05-01T12:00:00.000Z",
    referenceCount: 5,
    basic: {
      exposure: 0.25,
      contrast: 0.1,
      highlights: -0.4,
      shadows: 0.5,
      whites: 0.2,
      blacks: -0.3,
      texture: 0.1,
      clarity: 0.15,
      vibrance: 0.2,
      saturation: -0.05,
    },
    toneCurve,
    hsl,
    colorGrading: {
      shadows: { hue: 220, saturation: 0.2, luminance: -0.1 },
      midtones: { hue: 30, saturation: 0.15, luminance: 0.05 },
      highlights: { hue: 50, saturation: 0.25, luminance: 0.1 },
      global: { hue: 0, saturation: 0.05, luminance: 0 },
      blending: 0.5,
      balance: 0.0,
    },
    grain: {
      amount: 0.0,
      size: 0.4,
      roughness: 0.5,
    },
    vignette: {
      amount: -0.3,
      midpoint: 0.5,
      feather: 0.7,
    },
  };

  return { ...base, ...overrides };
}

describe("mapToLightroomScale", () => {
  it("maps the source midpoint to the destination midpoint", () => {
    expect(mapToLightroomScale(0, -1, 1, -100, 100)).toBe(0);
  });

  it("maps source max to destination max", () => {
    expect(mapToLightroomScale(1, -1, 1, -100, 100)).toBe(100);
  });

  it("maps source min to destination min", () => {
    expect(mapToLightroomScale(-1, -1, 1, -100, 100)).toBe(-100);
  });

  it("clamps values outside the source range", () => {
    expect(mapToLightroomScale(2, -1, 1, -100, 100)).toBe(100);
    expect(mapToLightroomScale(-2, -1, 1, -100, 100)).toBe(-100);
  });

  it("scales the unit interval to 0..100", () => {
    expect(mapToLightroomScale(0.5, 0, 1, 0, 100)).toBe(50);
  });
});

describe("writeLightroomXmp — XML well-formedness", () => {
  it("starts with the xpacket header", () => {
    const xmp = writeLightroomXmp(samplePreset());
    expect(xmp.startsWith(`<?xpacket begin=`)).toBe(true);
    expect(xmp).toContain(`id="W5M0MpCehiHzreSzNTczkc9d"`);
  });

  it("ends with the xpacket trailer", () => {
    const xmp = writeLightroomXmp(samplePreset());
    expect(xmp.trim().endsWith(`<?xpacket end="w"?>`)).toBe(true);
  });

  it("contains the xmpmeta root open and close tags", () => {
    const xmp = writeLightroomXmp(samplePreset());
    expect(xmp).toContain("<x:xmpmeta");
    expect(xmp).toContain("</x:xmpmeta>");
  });

  it("contains balanced rdf:Description tags", () => {
    const xmp = writeLightroomXmp(samplePreset());
    const opens = xmp.match(/<rdf:Description\b/g) ?? [];
    const closes = xmp.match(/<\/rdf:Description>/g) ?? [];
    expect(opens.length).toBe(1);
    expect(closes.length).toBe(1);
  });

  it("declares the required namespaces", () => {
    const xmp = writeLightroomXmp(samplePreset());
    expect(xmp).toContain(`xmlns:x="adobe:ns:meta/"`);
    expect(xmp).toContain(
      `xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"`,
    );
    expect(xmp).toContain(
      `xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"`,
    );
  });

  it("declares the preset metadata header attributes", () => {
    const xmp = writeLightroomXmp(samplePreset());
    expect(xmp).toMatch(/crs:Version="15\.4"/);
    expect(xmp).toMatch(/crs:ProcessVersion="11\.0"/);
    expect(xmp).toMatch(/crs:HasSettings="True"/);
    expect(xmp).toMatch(/crs:PresetType="Normal"/);
    expect(xmp).toMatch(/crs:Cluster="User Presets"/);
  });

  it("has no scientific notation in attribute values", () => {
    // We intentionally avoid scientific notation because Lightroom won't parse it.
    const xmp = writeLightroomXmp(samplePreset());
    expect(xmp).not.toMatch(/="[+-]?\d+(?:\.\d+)?[eE][+-]?\d+"/);
  });
});

describe("writeLightroomXmp — basic adjustments", () => {
  it("emits exposure as a signed two-decimal value", () => {
    const xmp = writeLightroomXmp(
      samplePreset({
        basic: {
          exposure: 0.25,
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
      }),
    );
    expect(xmp).toMatch(/crs:Exposure2012="\+0\.25"/);
  });

  it("scales contrast from -1..1 to -100..+100", () => {
    const xmp = writeLightroomXmp(
      samplePreset({
        basic: {
          exposure: 0,
          contrast: 0.5,
          highlights: -0.4,
          shadows: 0,
          whites: 0,
          blacks: 0,
          texture: 0,
          clarity: 0,
          vibrance: 0,
          saturation: 0,
        },
      }),
    );
    expect(xmp).toMatch(/crs:Contrast2012="\+50"/);
    expect(xmp).toMatch(/crs:Highlights2012="-40"/);
  });

  it("emits the parametric curve neutralisers", () => {
    const xmp = writeLightroomXmp(samplePreset());
    expect(xmp).toMatch(/crs:ParametricShadows="0"/);
    expect(xmp).toMatch(/crs:ParametricDarks="0"/);
    expect(xmp).toMatch(/crs:ParametricLights="0"/);
    expect(xmp).toMatch(/crs:ParametricHighlights="0"/);
  });
});

describe("writeLightroomXmp — preset name", () => {
  it("includes the preset name inside an rdf:Alt rdf:li", () => {
    const xmp = writeLightroomXmp(samplePreset({ name: "Golden Hour" }));
    expect(xmp).toMatch(
      /<rdf:Alt>\s*<rdf:li xml:lang="x-default">Golden Hour<\/rdf:li>\s*<\/rdf:Alt>/,
    );
  });

  it("escapes ampersands in the preset name", () => {
    const xmp = writeLightroomXmp(samplePreset({ name: "Sun & Sand" }));
    expect(xmp).toContain("Sun &amp; Sand");
    // Raw ampersand in the name must not appear unescaped.
    expect(xmp).not.toContain("Sun & Sand</rdf:li>");
  });

  it("escapes angle brackets and quotes in the preset name", () => {
    const xmp = writeLightroomXmp(
      samplePreset({ name: `<Cinematic> "Look"` }),
    );
    expect(xmp).toContain("&lt;Cinematic&gt;");
    expect(xmp).toContain("&quot;Look&quot;");
  });
});

describe("writeLightroomXmp — tone curve", () => {
  it("emits each curve point as an rdf:li entry inside crs:ToneCurvePV2012", () => {
    const xmp = writeLightroomXmp(samplePreset());
    const curveBlock = xmp.match(
      /<crs:ToneCurvePV2012>[\s\S]*?<\/crs:ToneCurvePV2012>/,
    );
    expect(curveBlock).not.toBeNull();
    const entries = curveBlock![0].match(/<rdf:li>[^<]+<\/rdf:li>/g) ?? [];
    expect(entries.length).toBe(5);
    expect(entries[0]).toMatch(/<rdf:li>0, 0<\/rdf:li>/);
    expect(entries[2]).toMatch(/<rdf:li>128, 130<\/rdf:li>/);
    expect(entries[4]).toMatch(/<rdf:li>255, 255<\/rdf:li>/);
  });

  it("wraps points in a single rdf:Seq", () => {
    const xmp = writeLightroomXmp(samplePreset());
    const seqOpens = xmp.match(/<rdf:Seq>/g) ?? [];
    const seqCloses = xmp.match(/<\/rdf:Seq>/g) ?? [];
    expect(seqOpens.length).toBe(seqCloses.length);
    expect(seqOpens.length).toBeGreaterThanOrEqual(1);
  });
});

describe("writeLightroomXmp — HSL panel", () => {
  it("emits 8 hue, 8 saturation, and 8 luminance attributes", () => {
    const xmp = writeLightroomXmp(samplePreset());
    const hueAttrs = xmp.match(/crs:HueAdjustment[A-Z][a-z]+="/g) ?? [];
    const satAttrs = xmp.match(/crs:SaturationAdjustment[A-Z][a-z]+="/g) ?? [];
    const lumAttrs = xmp.match(/crs:LuminanceAdjustment[A-Z][a-z]+="/g) ?? [];
    expect(hueAttrs.length).toBe(8);
    expect(satAttrs.length).toBe(8);
    expect(lumAttrs.length).toBe(8);
    // Together: 24 HSL adjustments.
    expect(hueAttrs.length + satAttrs.length + lumAttrs.length).toBe(24);
  });

  it("includes each named hue band exactly once per channel", () => {
    const xmp = writeLightroomXmp(samplePreset());
    const expected = [
      "Red",
      "Orange",
      "Yellow",
      "Green",
      "Aqua",
      "Blue",
      "Purple",
      "Magenta",
    ];
    for (const label of expected) {
      expect(xmp).toContain(`crs:HueAdjustment${label}="`);
      expect(xmp).toContain(`crs:SaturationAdjustment${label}="`);
      expect(xmp).toContain(`crs:LuminanceAdjustment${label}="`);
    }
  });
});

describe("writeLightroomXmp — color grading", () => {
  it("emits saturation values in the 0..100 range when input is 0..1", () => {
    const xmp = writeLightroomXmp(
      samplePreset({
        colorGrading: {
          shadows: { hue: 200, saturation: 0.3, luminance: 0 },
          midtones: { hue: 40, saturation: 0.7, luminance: 0 },
          highlights: { hue: 60, saturation: 1.0, luminance: 0 },
          global: { hue: 0, saturation: 0.0, luminance: 0 },
          blending: 0.5,
          balance: 0,
        },
      }),
    );
    expect(xmp).toMatch(/crs:ColorGradeShadowSat="30"/);
    expect(xmp).toMatch(/crs:ColorGradeMidtoneSat="70"/);
    expect(xmp).toMatch(/crs:ColorGradeHighlightSat="100"/);
    expect(xmp).toMatch(/crs:ColorGradeGlobalSat="0"/);
  });

  it("emits hue values as 0..360 integers", () => {
    const xmp = writeLightroomXmp(
      samplePreset({
        colorGrading: {
          shadows: { hue: 220, saturation: 0.2, luminance: 0 },
          midtones: { hue: 30, saturation: 0.2, luminance: 0 },
          highlights: { hue: 50, saturation: 0.2, luminance: 0 },
          global: { hue: 0, saturation: 0.2, luminance: 0 },
          blending: 0,
          balance: 0,
        },
      }),
    );
    expect(xmp).toMatch(/crs:ColorGradeShadowHue="220"/);
    expect(xmp).toMatch(/crs:ColorGradeMidtoneHue="30"/);
    expect(xmp).toMatch(/crs:ColorGradeHighlightHue="50"/);
    expect(xmp).toMatch(/crs:ColorGradeGlobalHue="0"/);
  });

  it("emits blending and balance in -100..+100", () => {
    const xmp = writeLightroomXmp(
      samplePreset({
        colorGrading: {
          shadows: { hue: 0, saturation: 0, luminance: 0 },
          midtones: { hue: 0, saturation: 0, luminance: 0 },
          highlights: { hue: 0, saturation: 0, luminance: 0 },
          global: { hue: 0, saturation: 0, luminance: 0 },
          blending: 0.5,
          balance: -0.25,
        },
      }),
    );
    expect(xmp).toMatch(/crs:ColorGradeBlending="\+50"/);
    expect(xmp).toMatch(/crs:ColorGradeBalance="-25"/);
  });
});

describe("writeLightroomXmp — grain and vignette", () => {
  it("always emits grain attributes, even when amount is zero", () => {
    const xmp = writeLightroomXmp(
      samplePreset({
        grain: { amount: 0, size: 0.4, roughness: 0.5 },
      }),
    );
    expect(xmp).toMatch(/crs:GrainAmount="0"/);
    expect(xmp).toMatch(/crs:GrainSize="40"/);
    expect(xmp).toMatch(/crs:GrainFrequency="50"/);
  });

  it("emits the post-crop vignette block with a fixed style", () => {
    const xmp = writeLightroomXmp(
      samplePreset({
        vignette: { amount: -0.3, midpoint: 0.5, feather: 0.7 },
      }),
    );
    expect(xmp).toMatch(/crs:PostCropVignetteAmount="-30"/);
    expect(xmp).toMatch(/crs:PostCropVignetteMidpoint="50"/);
    expect(xmp).toMatch(/crs:PostCropVignetteFeather="70"/);
    expect(xmp).toMatch(/crs:PostCropVignetteStyle="1"/);
  });
});
