/**
 * Lightroom XMP preset writer.
 *
 * Produces a `.xmp` file compatible with Lightroom Mobile and
 * Lightroom Classic. The output is a minimal, well-formed XMP packet
 * containing the camera-raw-settings (`crs:`) attributes Lightroom uses
 * for a Develop preset.
 */
import type {
  ColorGrading,
  ColorGradingWheel,
  HslAdjustments,
  HslHue,
  Profile,
  ToneCurvePoint,
} from "./types";

/** The eight HSL bands Lightroom recognises, in attribute-name order. */
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

/** Two-space indentation. */
const INDENT = "  ";

/**
 * Linearly remap `value` from `[fromMin, fromMax]` onto `[toMin, toMax]`.
 * Values outside the source range are clamped to the destination range.
 */
export function mapToLightroomScale(
  value: number,
  fromMin: number,
  fromMax: number,
  toMin: number,
  toMax: number,
): number {
  if (fromMax === fromMin) {
    return toMin;
  }
  const t = (value - fromMin) / (fromMax - fromMin);
  const mapped = toMin + t * (toMax - toMin);
  if (mapped < Math.min(toMin, toMax)) {
    return Math.min(toMin, toMax);
  }
  if (mapped > Math.max(toMin, toMax)) {
    return Math.max(toMin, toMax);
  }
  return mapped;
}

/**
 * Map a `[-1, 1]` profile value to a Lightroom `[-100, 100]` integer.
 */
function bipolarToLightroom(value: number): number {
  return Math.round(mapToLightroomScale(value, -1, 1, -100, 100));
}

/**
 * Map a `[0, 1]` profile value to a Lightroom `[0, 100]` integer.
 */
function unitToLightroom(value: number): number {
  return Math.round(mapToLightroomScale(value, 0, 1, 0, 100));
}

/**
 * Wrap a hue value into the `[0, 360)` integer range.
 */
function normalizeHueDegrees(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const wrapped = ((value % 360) + 360) % 360;
  return Math.round(wrapped) % 360;
}

/**
 * Format a Lightroom signed integer attribute value. Lightroom writes
 * the leading `+` for positive numbers; we mirror that to maximise
 * compatibility with Lightroom's preset round-trip.
 */
function formatSignedInt(value: number): string {
  if (value > 0) {
    return `+${value}`;
  }
  return `${value}`;
}

/**
 * Format a Lightroom signed decimal attribute value (used for
 * exposure-style values that Lightroom serialises with two decimals).
 */
function formatSignedDecimal(value: number): string {
  const fixed = value.toFixed(2);
  if (value > 0) {
    return `+${fixed}`;
  }
  return fixed;
}

/**
 * XML-escape a string for use in an attribute or text node.
 */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Render a single `crs:Foo="bar"` attribute on its own line.
 */
function attrLine(indent: string, name: string, value: string): string {
  return `${indent}${name}="${escapeXml(value)}"`;
}

/**
 * Render the `<crs:Name>` element using rdf:Alt + rdf:li (the form
 * Lightroom expects so the preset name shows up in the UI).
 */
function renderName(name: string, indent: string): string {
  const safe = escapeXml(name);
  return [
    `${indent}<crs:Name>`,
    `${indent}${INDENT}<rdf:Alt>`,
    `${indent}${INDENT}${INDENT}<rdf:li xml:lang="x-default">${safe}</rdf:li>`,
    `${indent}${INDENT}</rdf:Alt>`,
    `${indent}</crs:Name>`,
  ].join("\n");
}

/**
 * Render the point tone curve as an rdf:Seq of `"input, output"` pairs.
 */
function renderToneCurve(points: readonly ToneCurvePoint[], indent: string): string {
  const lines: string[] = [];
  lines.push(`${indent}<crs:ToneCurvePV2012>`);
  lines.push(`${indent}${INDENT}<rdf:Seq>`);
  for (const point of points) {
    const inputI = Math.round(Math.max(0, Math.min(255, point.input)));
    const outputI = Math.round(Math.max(0, Math.min(255, point.output)));
    lines.push(
      `${indent}${INDENT}${INDENT}<rdf:li>${inputI}, ${outputI}</rdf:li>`,
    );
  }
  lines.push(`${indent}${INDENT}</rdf:Seq>`);
  lines.push(`${indent}</crs:ToneCurvePV2012>`);
  return lines.join("\n");
}

/**
 * Capitalise an HSL hue name (e.g. `"red"` -> `"Red"`) for use in the
 * crs attribute name.
 */
function hueAttrName(hue: HslHue): string {
  return hue.charAt(0).toUpperCase() + hue.slice(1);
}

/**
 * Render the 24 HSL attributes (8 hues x { hue, saturation, luminance }).
 */
function renderHslAttributes(hsl: HslAdjustments, indent: string): string[] {
  const lines: string[] = [];
  for (const hue of HSL_HUES) {
    const adj = hsl[hue];
    const suffix = hueAttrName(hue);
    lines.push(
      attrLine(
        indent,
        `crs:HueAdjustment${suffix}`,
        formatSignedInt(bipolarToLightroom(adj.hue)),
      ),
    );
    lines.push(
      attrLine(
        indent,
        `crs:SaturationAdjustment${suffix}`,
        formatSignedInt(bipolarToLightroom(adj.saturation)),
      ),
    );
    lines.push(
      attrLine(
        indent,
        `crs:LuminanceAdjustment${suffix}`,
        formatSignedInt(bipolarToLightroom(adj.luminance)),
      ),
    );
  }
  return lines;
}

/**
 * Render the four colour-grading wheels plus the blending/balance pair.
 */
function renderColorGradingAttributes(
  grading: ColorGrading,
  indent: string,
): string[] {
  const lines: string[] = [];
  const wheelByName: ReadonlyArray<readonly [string, ColorGradingWheel]> = [
    ["Shadow", grading.shadows],
    ["Midtone", grading.midtones],
    ["Highlight", grading.highlights],
    ["Global", grading.global],
  ];
  for (const [label, wheel] of wheelByName) {
    lines.push(
      attrLine(
        indent,
        `crs:ColorGrade${label}Hue`,
        `${normalizeHueDegrees(wheel.hue)}`,
      ),
    );
    lines.push(
      attrLine(
        indent,
        `crs:ColorGrade${label}Sat`,
        `${unitToLightroom(wheel.saturation)}`,
      ),
    );
    lines.push(
      attrLine(
        indent,
        `crs:ColorGrade${label}Lum`,
        formatSignedInt(bipolarToLightroom(wheel.luminance)),
      ),
    );
  }
  lines.push(
    attrLine(
      indent,
      "crs:ColorGradeBlending",
      formatSignedInt(bipolarToLightroom(grading.blending)),
    ),
  );
  lines.push(
    attrLine(
      indent,
      "crs:ColorGradeBalance",
      formatSignedInt(bipolarToLightroom(grading.balance)),
    ),
  );
  return lines;
}

/**
 * Serialise a {@link Profile} as a Lightroom XMP preset string.
 *
 * The resulting UTF-8 string is suitable for direct download as a
 * `.xmp` file. It can be imported by Lightroom Classic (Develop ->
 * Presets -> Import) and Lightroom Mobile (Presets -> Import Presets).
 *
 * @param profile - the extracted style profile
 * @returns the full XMP packet as a string
 */
export function writeLightroomXmp(profile: Profile): string {
  const descIndent = `${INDENT}${INDENT}${INDENT}`;
  const childIndent = `${descIndent}${INDENT}`;

  const basicAttrs: string[] = [
    // Exposure2012 is in stops, not the -100..100 panel scale.
    // We pass the profile value through unchanged and format with two decimals.
    attrLine(
      descIndent,
      "crs:Exposure2012",
      formatSignedDecimal(profile.basic.exposure),
    ),
    attrLine(
      descIndent,
      "crs:Contrast2012",
      formatSignedInt(bipolarToLightroom(profile.basic.contrast)),
    ),
    attrLine(
      descIndent,
      "crs:Highlights2012",
      formatSignedInt(bipolarToLightroom(profile.basic.highlights)),
    ),
    attrLine(
      descIndent,
      "crs:Shadows2012",
      formatSignedInt(bipolarToLightroom(profile.basic.shadows)),
    ),
    attrLine(
      descIndent,
      "crs:Whites2012",
      formatSignedInt(bipolarToLightroom(profile.basic.whites)),
    ),
    attrLine(
      descIndent,
      "crs:Blacks2012",
      formatSignedInt(bipolarToLightroom(profile.basic.blacks)),
    ),
    attrLine(
      descIndent,
      "crs:Texture",
      formatSignedInt(bipolarToLightroom(profile.basic.texture)),
    ),
    attrLine(
      descIndent,
      "crs:Clarity2012",
      formatSignedInt(bipolarToLightroom(profile.basic.clarity)),
    ),
    attrLine(
      descIndent,
      "crs:Vibrance",
      formatSignedInt(bipolarToLightroom(profile.basic.vibrance)),
    ),
    attrLine(
      descIndent,
      "crs:Saturation",
      formatSignedInt(bipolarToLightroom(profile.basic.saturation)),
    ),
  ];

  const parametricAttrs: string[] = [
    attrLine(descIndent, "crs:ParametricShadows", "0"),
    attrLine(descIndent, "crs:ParametricDarks", "0"),
    attrLine(descIndent, "crs:ParametricLights", "0"),
    attrLine(descIndent, "crs:ParametricHighlights", "0"),
  ];

  const hslAttrs = renderHslAttributes(profile.hsl, descIndent);
  const colorGradingAttrs = renderColorGradingAttributes(
    profile.colorGrading,
    descIndent,
  );

  const grainAttrs: string[] = [
    attrLine(
      descIndent,
      "crs:GrainAmount",
      `${unitToLightroom(profile.grain.amount)}`,
    ),
    attrLine(
      descIndent,
      "crs:GrainSize",
      `${unitToLightroom(profile.grain.size)}`,
    ),
    attrLine(
      descIndent,
      "crs:GrainFrequency",
      `${unitToLightroom(profile.grain.roughness)}`,
    ),
  ];

  const vignetteAttrs: string[] = [
    attrLine(
      descIndent,
      "crs:PostCropVignetteAmount",
      formatSignedInt(bipolarToLightroom(profile.vignette.amount)),
    ),
    attrLine(
      descIndent,
      "crs:PostCropVignetteMidpoint",
      `${unitToLightroom(profile.vignette.midpoint)}`,
    ),
    attrLine(
      descIndent,
      "crs:PostCropVignetteFeather",
      `${unitToLightroom(profile.vignette.feather)}`,
    ),
    attrLine(descIndent, "crs:PostCropVignetteStyle", "1"),
  ];

  const headerAttrs: string[] = [
    attrLine(descIndent, "crs:Version", "15.4"),
    attrLine(descIndent, "crs:ProcessVersion", "11.0"),
    attrLine(descIndent, "crs:HasSettings", "True"),
    attrLine(descIndent, "crs:PresetType", "Normal"),
    attrLine(descIndent, "crs:Cluster", "User Presets"),
  ];

  const allAttrs = [
    ...headerAttrs,
    ...basicAttrs,
    ...parametricAttrs,
    ...hslAttrs,
    ...colorGradingAttrs,
    ...grainAttrs,
    ...vignetteAttrs,
  ];

  const namespaces = [
    `${descIndent}xmlns:x="adobe:ns:meta/"`,
    `${descIndent}xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"`,
    `${descIndent}xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"`,
  ];

  const lines: string[] = [];
  lines.push(`<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>`);
  lines.push(`<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="style-extractor">`);
  lines.push(`${INDENT}<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">`);
  lines.push(`${INDENT}${INDENT}<rdf:Description rdf:about=""`);
  lines.push(namespaces.join("\n"));
  lines.push(allAttrs.join("\n"));
  lines.push(`${descIndent}>`);
  lines.push(renderName(profile.name, childIndent));
  lines.push(renderToneCurve(profile.toneCurve, childIndent));
  lines.push(`${INDENT}${INDENT}</rdf:Description>`);
  lines.push(`${INDENT}</rdf:RDF>`);
  lines.push(`</x:xmpmeta>`);
  lines.push(`<?xpacket end="w"?>`);
  return lines.join("\n");
}
