import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dropzone,
  FileList,
  Header,
  PresetCard,
  PrimaryButton,
  Progress,
  ResultTile,
} from "./components";
import {
  deletePreset,
  downloadFile,
  listPresets,
  presetIdFromName,
  savePreset,
  type StoredPreset,
} from "./lib/profileStorage";
import type {
  ApplyResultMessage,
  WorkerInput,
  WorkerOutput,
} from "./workers/extractor.worker";

type BuildState =
  | { kind: "idle" }
  | { kind: "running"; processed: number; total: number; phase: string }
  | { kind: "error"; message: string };

interface AppliedResult {
  id: string;
  file: File;
  fileName: string;
  beforeUrl: string;
  afterUrl: string;
  width: number;
  height: number;
  strength: number;
  isReprocessing: boolean;
}

type ApplyJobState =
  | { kind: "idle" }
  | { kind: "running"; processed: number; total: number; phase: string }
  | { kind: "error"; message: string };

const DEFAULT_NAME = "My Style";

export function App() {
  const [presets, setPresets] = useState<StoredPreset[]>([]);

  // Build (preset extractor) state
  const [buildName, setBuildName] = useState<string>(DEFAULT_NAME);
  const [buildFiles, setBuildFiles] = useState<File[]>([]);
  const [buildState, setBuildState] = useState<BuildState>({ kind: "idle" });

  // Apply state
  const [applyPresetId, setApplyPresetId] = useState<string>("");
  const [applyFiles, setApplyFiles] = useState<File[]>([]);
  const [applyStrength, setApplyStrength] = useState<number>(1);
  const [applyState, setApplyState] = useState<ApplyJobState>({ kind: "idle" });
  const [results, setResults] = useState<AppliedResult[]>([]);

  // Pending reapply requests, keyed by request id
  const reapplyMapRef = useRef<Map<string, string>>(new Map());

  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    refreshPresets();
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  // Cleanup any object URLs when results change or unmount
  useEffect(() => {
    return () => {
      results.forEach((r) => {
        URL.revokeObjectURL(r.beforeUrl);
        URL.revokeObjectURL(r.afterUrl);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pick the most recent preset by default once presets are loaded
  useEffect(() => {
    if (presets.length === 0) {
      setApplyPresetId("");
      return;
    }
    if (!presets.find((p) => p.id === applyPresetId)) {
      setApplyPresetId(presets[0].id);
    }
  }, [presets, applyPresetId]);

  function refreshPresets() {
    listPresets()
      .then(setPresets)
      .catch((err) => console.warn("Could not load saved presets:", err));
  }

  function ensureWorker(): Worker {
    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL("./workers/extractor.worker.ts", import.meta.url),
        { type: "module" },
      );
      workerRef.current.addEventListener("message", handleWorkerMessage);
    }
    return workerRef.current;
  }

  // Single message handler that demultiplexes based on message type
  async function handleWorkerMessage(event: MessageEvent<WorkerOutput>) {
    const msg = event.data;
    if (msg.type === "progress") {
      // The "progress" applies to whichever job is currently active.
      // Both states share the same shape.
      if (
        ["decoding", "analyzing", "building-profile", "rendering-presets"].includes(
          msg.phase,
        )
      ) {
        setBuildState({
          kind: "running",
          processed: msg.processed,
          total: msg.total,
          phase: msg.phase,
        });
      } else {
        setApplyState({
          kind: "running",
          processed: msg.processed,
          total: msg.total,
          phase: msg.phase,
        });
      }
    } else if (msg.type === "build-done") {
      const stored: StoredPreset = {
        id: presetIdFromName(msg.profile.name),
        profile: msg.profile,
        xmp: msg.xmp,
        cube: msg.cube,
        createdAt: msg.profile.createdAt,
      };
      try {
        await savePreset(stored);
      } catch (err) {
        console.warn("Could not save preset locally:", err);
      }
      setBuildFiles([]);
      setBuildState({ kind: "idle" });
      refreshPresets();
    } else if (msg.type === "apply-done") {
      const newResults: AppliedResult[] = msg.results.map((r) =>
        applyMessageToResult(r, getMatchingFile(r.fileName), applyStrength),
      );
      setResults((prev) => {
        // Keep older results; append new ones (no overlap on file refs)
        return [...newResults, ...prev];
      });
      setApplyFiles([]);
      setApplyState({ kind: "idle" });
    } else if (msg.type === "reapply-done") {
      const tileId = reapplyMapRef.current.get(msg.requestId);
      reapplyMapRef.current.delete(msg.requestId);
      if (!tileId) return;
      setResults((prev) =>
        prev.map((r) => {
          if (r.id !== tileId) return r;
          URL.revokeObjectURL(r.beforeUrl);
          URL.revokeObjectURL(r.afterUrl);
          return {
            ...r,
            beforeUrl: URL.createObjectURL(msg.result.beforeBlob),
            afterUrl: URL.createObjectURL(msg.result.afterBlob),
            width: msg.result.width,
            height: msg.result.height,
            isReprocessing: false,
          };
        }),
      );
    } else if (msg.type === "error") {
      // Dispatch to whichever job had a non-idle state.
      setBuildState((s) => (s.kind === "running" ? { kind: "error", message: msg.message } : s));
      setApplyState((s) => (s.kind === "running" ? { kind: "error", message: msg.message } : s));
    }
  }

  function getMatchingFile(fileName: string): File {
    const found = applyFiles.find((f) => f.name === fileName);
    if (found) return found;
    // Should never happen but the type system insists on a File for reapply
    return new File([], fileName);
  }

  function applyMessageToResult(
    msg: ApplyResultMessage,
    file: File,
    strength: number,
  ): AppliedResult {
    return {
      id: `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      fileName: msg.fileName,
      beforeUrl: URL.createObjectURL(msg.beforeBlob),
      afterUrl: URL.createObjectURL(msg.afterBlob),
      width: msg.width,
      height: msg.height,
      strength,
      isReprocessing: false,
    };
  }

  // === Build flow ===

  function addBuildFiles(incoming: File[]) {
    setBuildFiles((prev) => mergeUniqueFiles(prev, incoming));
  }

  function removeBuildFile(index: number) {
    setBuildFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function startBuild() {
    if (buildFiles.length === 0 || buildState.kind === "running") return;
    const worker = ensureWorker();
    setBuildState({
      kind: "running",
      processed: 0,
      total: buildFiles.length,
      phase: "starting",
    });
    const input: WorkerInput = {
      type: "build",
      name: buildName.trim() || DEFAULT_NAME,
      files: buildFiles,
    };
    worker.postMessage(input);
  }

  // === Apply flow ===

  function addApplyFiles(incoming: File[]) {
    setApplyFiles((prev) => mergeUniqueFiles(prev, incoming));
  }

  function removeApplyFile(index: number) {
    setApplyFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function startApply() {
    if (
      applyFiles.length === 0 ||
      applyState.kind === "running" ||
      !applyPresetId
    ) {
      return;
    }
    const preset = presets.find((p) => p.id === applyPresetId);
    if (!preset) return;
    const worker = ensureWorker();
    setApplyState({
      kind: "running",
      processed: 0,
      total: applyFiles.length,
      phase: "starting",
    });
    const input: WorkerInput = {
      type: "apply",
      profile: preset.profile,
      files: applyFiles,
      strength: applyStrength,
    };
    worker.postMessage(input);
  }

  function reapply(result: AppliedResult, newStrength: number) {
    if (!applyPresetId) return;
    const preset = presets.find((p) => p.id === applyPresetId);
    if (!preset) return;
    const worker = ensureWorker();
    const requestId = `${result.id}-${Date.now()}`;
    reapplyMapRef.current.set(requestId, result.id);
    setResults((prev) =>
      prev.map((r) =>
        r.id === result.id ? { ...r, strength: newStrength, isReprocessing: true } : r,
      ),
    );
    const input: WorkerInput = {
      type: "reapply",
      profile: preset.profile,
      file: result.file,
      strength: newStrength,
      requestId,
    };
    worker.postMessage(input);
  }

  function downloadResult(r: AppliedResult) {
    const baseName = r.fileName.replace(/\.[^.]+$/, "");
    const presetName = presets.find((p) => p.id === applyPresetId)?.profile.name ?? "preset";
    const slug = slugify(presetName);
    const a = document.createElement("a");
    a.href = r.afterUrl;
    a.download = `${baseName}.${slug}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function removeResult(r: AppliedResult) {
    URL.revokeObjectURL(r.beforeUrl);
    URL.revokeObjectURL(r.afterUrl);
    setResults((prev) => prev.filter((x) => x.id !== r.id));
  }

  // === Preset card actions ===

  async function onDeletePreset(id: string) {
    try {
      await deletePreset(id);
      refreshPresets();
    } catch (err) {
      console.warn("Could not delete preset:", err);
    }
  }

  function onDownloadXmp(p: StoredPreset) {
    downloadFile(`${slugify(p.profile.name)}.xmp`, p.xmp, "application/rdf+xml");
  }

  function onDownloadCube(p: StoredPreset) {
    downloadFile(`${slugify(p.profile.name)}.cube`, p.cube, "text/plain");
  }

  // === Derived UI strings ===

  const buildButtonLabel = useMemo(() => {
    if (buildState.kind === "running") {
      const pct = buildState.total === 0 ? 0 : Math.round((buildState.processed / buildState.total) * 100);
      return `Building… ${pct}%`;
    }
    return buildFiles.length === 0
      ? "Add references to begin"
      : `Build preset from ${buildFiles.length} photo${buildFiles.length === 1 ? "" : "s"}`;
  }, [buildFiles.length, buildState]);

  const applyButtonLabel = useMemo(() => {
    if (applyState.kind === "running") {
      const pct = applyState.total === 0 ? 0 : Math.round((applyState.processed / applyState.total) * 100);
      return `Filtering… ${pct}%`;
    }
    return applyFiles.length === 0
      ? "Add photos to filter"
      : `Filter ${applyFiles.length} photo${applyFiles.length === 1 ? "" : "s"}`;
  }, [applyFiles.length, applyState]);

  const hasPresets = presets.length > 0;

  return (
    <div className="min-h-screen flex flex-col">
      <Header
        title="Style Extractor"
        subtitle="Drop reference photos → get a Lightroom preset → filter your own photos."
      />

      <main className="flex-1 px-5 py-6 space-y-8 max-w-2xl mx-auto w-full">
        {hasPresets ? (
          <section className="space-y-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-track-steel">
              Apply a preset
            </h2>
            <label className="block">
              <span className="block text-sm text-track-steel mb-2">Preset</span>
              <select
                value={applyPresetId}
                onChange={(e) => setApplyPresetId(e.target.value)}
                disabled={applyState.kind === "running"}
                className="w-full rounded-xl bg-track-ink border border-track-smoke px-4 py-3 text-base text-track-chalk focus:outline-none focus:border-track-flame transition appearance-none"
              >
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.profile.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="flex justify-between text-sm text-track-steel mb-2">
                <span>Default strength</span>
                <span className="text-track-chalk font-medium">{Math.round(applyStrength * 100)}%</span>
              </span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(applyStrength * 100)}
                onChange={(e) => setApplyStrength(Number(e.target.value) / 100)}
                disabled={applyState.kind === "running"}
                className="w-full accent-track-flame"
              />
            </label>

            <Dropzone
              label="Add your photos"
              helper="They'll be filtered with the selected preset. Photos never leave your device."
              onFiles={addApplyFiles}
              disabled={applyState.kind === "running"}
            />

            {applyFiles.length > 0 ? (
              <FileList
                files={applyFiles}
                onRemove={applyState.kind === "running" ? undefined : removeApplyFile}
              />
            ) : null}

            {applyState.kind === "running" ? (
              <Progress
                value={applyState.processed}
                max={applyState.total}
                label={phaseLabel(applyState.phase)}
              />
            ) : null}

            {applyState.kind === "error" ? (
              <p className="text-sm text-track-flame">{applyState.message}</p>
            ) : null}

            <PrimaryButton
              onClick={startApply}
              disabled={
                applyFiles.length === 0 ||
                applyState.kind === "running" ||
                !applyPresetId
              }
              loading={applyState.kind === "running"}
            >
              {applyButtonLabel}
            </PrimaryButton>
          </section>
        ) : null}

        {results.length > 0 ? (
          <section className="space-y-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-track-steel">
              Filtered photos
            </h2>
            <p className="text-xs text-track-steel">
              Use the slider to compare before/after. Adjust strength per photo, then download the ones you like.
            </p>
            <div className="space-y-4">
              {results.map((r) => (
                <ResultTile
                  key={r.id}
                  fileName={r.fileName}
                  beforeUrl={r.beforeUrl}
                  afterUrl={r.afterUrl}
                  width={r.width}
                  height={r.height}
                  strength={r.strength}
                  isReprocessing={r.isReprocessing}
                  onStrengthChange={(s) => reapply(r, s)}
                  onReprocess={() => reapply(r, r.strength)}
                  onDownload={() => downloadResult(r)}
                  onRemove={() => removeResult(r)}
                />
              ))}
            </div>
          </section>
        ) : null}

        {hasPresets ? (
          <section className="space-y-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-track-steel">
              Your presets
            </h2>
            <div className="space-y-3">
              {presets.map((p) => (
                <PresetCard
                  key={p.id}
                  name={p.profile.name}
                  createdAt={p.createdAt}
                  onDownloadXmp={() => onDownloadXmp(p)}
                  onDownloadCube={() => onDownloadCube(p)}
                  onDelete={() => onDeletePreset(p.id)}
                />
              ))}
            </div>
          </section>
        ) : null}

        <section className="space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-track-steel">
            {hasPresets ? "Build a new preset" : "Build a preset"}
          </h2>
          <label className="block">
            <span className="block text-sm text-track-steel mb-2">Preset name</span>
            <input
              type="text"
              value={buildName}
              onChange={(e) => setBuildName(e.target.value)}
              maxLength={60}
              placeholder="@mchphotocz"
              disabled={buildState.kind === "running"}
              className="w-full rounded-xl bg-track-ink border border-track-smoke px-4 py-3 text-base text-track-chalk placeholder:text-track-smoke focus:outline-none focus:border-track-flame transition"
            />
          </label>

          <Dropzone
            label="Add reference photos"
            helper="25–40 images of one photographer's style works best."
            onFiles={addBuildFiles}
            disabled={buildState.kind === "running"}
          />

          {buildFiles.length > 0 ? (
            <FileList
              files={buildFiles}
              onRemove={buildState.kind === "running" ? undefined : removeBuildFile}
            />
          ) : null}

          {buildState.kind === "running" ? (
            <Progress
              value={buildState.processed}
              max={buildState.total}
              label={phaseLabel(buildState.phase)}
            />
          ) : null}

          {buildState.kind === "error" ? (
            <p className="text-sm text-track-flame">{buildState.message}</p>
          ) : null}

          <PrimaryButton
            onClick={startBuild}
            disabled={buildFiles.length === 0 || buildState.kind === "running"}
            loading={buildState.kind === "running"}
          >
            {buildButtonLabel}
          </PrimaryButton>
        </section>

        <section className="text-xs text-track-steel space-y-2 pt-4 border-t border-track-smoke">
          <p>All processing happens in your browser. Photos never leave your device.</p>
          <p>
            <strong className="text-track-chalk">Lightroom users:</strong>{" "}
            download the .xmp from a preset → open Lightroom Mobile → Presets → ⋯ → Import preset.
          </p>
        </section>
      </main>
    </div>
  );
}

function mergeUniqueFiles(prev: File[], incoming: File[]): File[] {
  const seen = new Set(prev.map((f) => `${f.name}:${f.size}`));
  const next = [...prev];
  for (const f of incoming) {
    const key = `${f.name}:${f.size}`;
    if (!seen.has(key)) {
      seen.add(key);
      next.push(f);
    }
  }
  return next;
}

function phaseLabel(phase: string): string {
  switch (phase) {
    case "decoding":
      return "Decoding images";
    case "analyzing":
      return "Analyzing photos";
    case "building-profile":
      return "Averaging the look";
    case "rendering-presets":
      return "Rendering preset & LUT";
    case "baking-lut":
      return "Preparing filter";
    case "filtering":
      return "Applying filter";
    case "starting":
      return "Starting";
    default:
      return phase;
  }
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 50) || "preset"
  );
}
