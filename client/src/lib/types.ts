/**
 * Shared type definitions used by every math/emitter module.
 * Edit this carefully — many modules depend on these shapes.
 */

export type RGB = readonly [number, number, number];
export type LAB = readonly [number, number, number];
export type HSV = readonly [number, number, number];

export type Channel = "L" | "a" | "b";

export interface Histogram {
  readonly bins: Float64Array;
  readonly min: number;
  readonly max: number;
}

export interface ToneCurvePoint {
  readonly input: number;
  readonly output: number;
}

export interface ColorGradingWheel {
  readonly hue: number;
  readonly saturation: number;
  readonly luminance: number;
}

export interface ColorGrading {
  readonly shadows: ColorGradingWheel;
  readonly midtones: ColorGradingWheel;
  readonly highlights: ColorGradingWheel;
  readonly global: ColorGradingWheel;
  readonly blending: number;
  readonly balance: number;
}

export type HslHue =
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "aqua"
  | "blue"
  | "purple"
  | "magenta";

export type HslAdjustments = {
  readonly [k in HslHue]: { readonly hue: number; readonly saturation: number; readonly luminance: number };
};

export interface BasicAdjustments {
  readonly exposure: number;
  readonly contrast: number;
  readonly highlights: number;
  readonly shadows: number;
  readonly whites: number;
  readonly blacks: number;
  readonly texture: number;
  readonly clarity: number;
  readonly vibrance: number;
  readonly saturation: number;
}

export interface GrainSettings {
  readonly amount: number;
  readonly size: number;
  readonly roughness: number;
}

export interface VignetteSettings {
  readonly amount: number;
  readonly midpoint: number;
  readonly feather: number;
}

export interface Profile {
  readonly name: string;
  readonly createdAt: string;
  readonly referenceCount: number;
  readonly basic: BasicAdjustments;
  readonly toneCurve: readonly ToneCurvePoint[];
  readonly hsl: HslAdjustments;
  readonly colorGrading: ColorGrading;
  readonly grain: GrainSettings;
  readonly vignette: VignetteSettings;
}

export interface ImageStats {
  readonly width: number;
  readonly height: number;
  readonly luminanceCdf: Float64Array;
  readonly aChannelByLBand: { shadows: number; midtones: number; highlights: number };
  readonly bChannelByLBand: { shadows: number; midtones: number; highlights: number };
  readonly hueBins: Float64Array;
  readonly saturationBins: Float64Array;
  readonly luminanceBins: Float64Array;
  readonly avgSaturation: number;
  readonly rmsContrast: number;
  readonly midFreqContrast: number;
  readonly noiseLevel: number;
  readonly cornerCenterLuminanceRatio: number;
}

export const HSL_HUE_CENTERS: Record<HslHue, number> = {
  red: 0,
  orange: 30,
  yellow: 60,
  green: 120,
  aqua: 180,
  blue: 240,
  purple: 270,
  magenta: 300,
};
