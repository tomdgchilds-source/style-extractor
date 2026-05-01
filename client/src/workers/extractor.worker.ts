/// <reference lib="webworker" />

import { extractProfile } from "../lib/extract";
import {
  bitmapToImageData,
  computeImageStats,
  decodeAndResize,
} from "../lib/imageStats";
import { writeCubeLut } from "../lib/cube";
import { writeLightroomXmp } from "../lib/xmp";
import type { ImageStats, Profile } from "../lib/types";

export type WorkerInput =
  | { type: "build"; name: string; files: readonly File[] }
  | { type: "cancel" };

export type WorkerOutput =
  | { type: "progress"; processed: number; total: number; phase: string }
  | { type: "done"; profile: Profile; xmp: string; cube: string }
  | { type: "error"; message: string };

const ctx: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope;

let cancelled = false;

ctx.onmessage = async (event: MessageEvent<WorkerInput>) => {
  const data = event.data;
  if (data.type === "cancel") {
    cancelled = true;
    return;
  }
  if (data.type !== "build") return;
  cancelled = false;

  try {
    await runBuild(data.name, data.files);
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
      // Skip a single bad file rather than aborting the whole batch.
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
  post({ type: "done", profile, xmp, cube });
}

function post(msg: WorkerOutput) {
  ctx.postMessage(msg);
}

export {};
