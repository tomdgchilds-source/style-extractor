/// <reference lib="webworker" />

import { extractProfile } from "../lib/extract";
import {
  bitmapToImageData,
  computeImageStats,
  decodeAndResize,
} from "../lib/imageStats";
import { writeCubeLut } from "../lib/cube";
import { writeLightroomXmp } from "../lib/xmp";
import { applyToImage, type ApplyResult } from "../lib/applyImage";
import { bakeLut } from "../lib/lutApply";
import type { ImageStats, Profile } from "../lib/types";

export type WorkerInput =
  | { type: "build"; name: string; files: readonly File[] }
  | {
      type: "apply";
      profile: Profile;
      files: readonly File[];
      strength: number;
    }
  | {
      type: "reapply";
      profile: Profile;
      file: File;
      strength: number;
      requestId: string;
    }
  | { type: "cancel" };

export interface ApplyResultMessage {
  fileName: string;
  beforeBlob: Blob;
  afterBlob: Blob;
  width: number;
  height: number;
  mime: "image/jpeg";
}

export type WorkerOutput =
  | { type: "progress"; processed: number; total: number; phase: string }
  | { type: "build-done"; profile: Profile; xmp: string; cube: string }
  | { type: "apply-done"; results: ApplyResultMessage[] }
  | {
      type: "reapply-done";
      requestId: string;
      result: ApplyResultMessage;
    }
  | { type: "error"; message: string };

const ctx: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope;

let cancelled = false;

ctx.onmessage = async (event: MessageEvent<WorkerInput>) => {
  const data = event.data;
  if (data.type === "cancel") {
    cancelled = true;
    return;
  }
  cancelled = false;

  try {
    if (data.type === "build") {
      await runBuild(data.name, data.files);
    } else if (data.type === "apply") {
      await runApply(data.profile, data.files, data.strength);
    } else if (data.type === "reapply") {
      await runReapply(
        data.profile,
        data.file,
        data.strength,
        data.requestId,
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    post({ type: "error", message });
  }
};

async function runBuild(name: string, files: readonly File[]) {
  const total = files.length;
  if (total === 0) {
    throw new Error("No reference images provided.");
  }

  post({ type: "progress", processed: 0, total, phase: "decoding" });
  const stats: ImageStats[] = [];
  for (let i = 0; i < total; i++) {
    if (cancelled) return;
    const file = files[i];
    try {
      const bitmap = await decodeAndResize(file);
      const imageData = bitmapToImageData(bitmap);
      bitmap.close();
      const s = computeImageStats(imageData);
      stats.push(s);
    } catch (err) {
      console.warn(`Skipping ${file.name}:`, err);
    }
    post({
      type: "progress",
      processed: i + 1,
      total,
      phase: "analyzing",
    });
  }

  if (stats.length === 0) {
    throw new Error(
      "Could not decode any of the provided images. Are they valid photos?",
    );
  }

  if (cancelled) return;
  post({
    type: "progress",
    processed: total,
    total,
    phase: "building-profile",
  });
  const profile = extractProfile(stats, name);

  if (cancelled) return;
  post({
    type: "progress",
    processed: total,
    total,
    phase: "rendering-presets",
  });
  const xmp = writeLightroomXmp(profile);
  const cube = writeCubeLut(profile, 33);

  if (cancelled) return;
  post({ type: "build-done", profile, xmp, cube });
}

async function runApply(
  profile: Profile,
  files: readonly File[],
  strength: number,
) {
  const total = files.length;
  if (total === 0) throw new Error("No photos to filter.");

  post({ type: "progress", processed: 0, total, phase: "baking-lut" });
  const lut = bakeLut(profile);

  const results: ApplyResultMessage[] = [];
  for (let i = 0; i < total; i++) {
    if (cancelled) return;
    const file = files[i];
    post({
      type: "progress",
      processed: i,
      total,
      phase: "filtering",
    });
    try {
      const r = await applyToImage(file, profile, {
        strength,
        cachedLut: lut,
        fileName: file.name,
      });
      results.push(toMessage(r));
    } catch (err) {
      console.warn(`Could not filter ${file.name}:`, err);
    }
  }

  if (cancelled) return;
  post({
    type: "progress",
    processed: total,
    total,
    phase: "filtering",
  });
  post({ type: "apply-done", results });
}

async function runReapply(
  profile: Profile,
  file: File,
  strength: number,
  requestId: string,
) {
  const r = await applyToImage(file, profile, {
    strength,
    fileName: file.name,
  });
  post({ type: "reapply-done", requestId, result: toMessage(r) });
}

function toMessage(r: ApplyResult): ApplyResultMessage {
  return {
    fileName: r.fileName,
    beforeBlob: r.beforeBlob,
    afterBlob: r.afterBlob,
    width: r.width,
    height: r.height,
    mime: r.mime,
  };
}

function post(msg: WorkerOutput) {
  ctx.postMessage(msg);
}

export {};
