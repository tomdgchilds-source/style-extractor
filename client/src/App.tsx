import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dropzone,
  FileList,
  Header,
  PresetCard,
  PrimaryButton,
  Progress,
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
  WorkerInput,
  WorkerOutput,
} from "./workers/extractor.worker";

type BuildState =
  | { kind: "idle" }
  | { kind: "building"; processed: number; total: number; phase: string }
  | { kind: "error"; message: string };

const DEFAULT_NAME = "My Style";

export function App() {
  const [files, setFiles] = useState<File[]>([]);
  const [name, setName] = useState<string>(DEFAULT_NAME);
  const [state, setState] = useState<BuildState>({ kind: "idle" });
  const [presets, setPresets] = useState<StoredPreset[]>([]);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    refreshPresets();
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

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
    }
    return workerRef.current;
  }

  function addFiles(incoming: File[]) {
    setFiles((prev) => {
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
    });
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function startBuild() {
    if (files.length === 0 || state.kind === "building") return;
    const worker = ensureWorker();
    setState({ kind: "building", processed: 0, total: files.length, phase: "starting" });

    const handler = async (event: MessageEvent<WorkerOutput>) => {
      const msg = event.data;
      if (msg.type === "progress") {
        setState({
          kind: "building",
          processed: msg.processed,
          total: msg.total,
          phase: msg.phase,
        });
      } else if (msg.type === "done") {
        worker.removeEventListener("message", handler);
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
        setFiles([]);
        setState({ kind: "idle" });
        refreshPresets();
      } else if (msg.type === "error") {
        worker.removeEventListener("message", handler);
        setState({ kind: "error", message: msg.message });
      }
    };
    worker.addEventListener("message", handler);
    const input: WorkerInput = { type: "build", name: name.trim() || DEFAULT_NAME, files };
    worker.postMessage(input);
  }

  async function onDelete(id: string) {
    try {
      await deletePreset(id);
      refreshPresets();
    } catch (err) {
      console.warn("Could not delete preset:", err);
    }
  }

  function onDownloadXmp(p: StoredPreset) {
    const filename = `${slugify(p.profile.name)}.xmp`;
    downloadFile(filename, p.xmp, "application/rdf+xml");
  }

  function onDownloadCube(p: StoredPreset) {
    const filename = `${slugify(p.profile.name)}.cube`;
    downloadFile(filename, p.cube, "text/plain");
  }

  const buildButtonLabel = useMemo(() => {
    if (state.kind === "building") {
      const pct = state.total === 0 ? 0 : Math.round((state.processed / state.total) * 100);
      return `Building… ${pct}%`;
    }
    return files.length === 0 ? "Add photos to begin" : `Build preset from ${files.length} photo${files.length === 1 ? "" : "s"}`;
  }, [files.length, state]);

  return (
    <div className="min-h-screen flex flex-col">
      <Header
        title="Style Extractor"
        subtitle="Drop reference photos → get a Lightroom preset."
      />

      <main className="flex-1 px-5 py-6 space-y-6 max-w-2xl mx-auto w-full">
        {presets.length > 0 ? (
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
                  onDelete={() => onDelete(p.id)}
                />
              ))}
            </div>
          </section>
        ) : null}

        <section className="space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-track-steel">
            New preset
          </h2>
          <label className="block">
            <span className="block text-sm text-track-steel mb-2">Preset name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              placeholder="@mchphotocz"
              disabled={state.kind === "building"}
              className="w-full rounded-xl bg-track-ink border border-track-smoke px-4 py-3 text-base text-track-chalk placeholder:text-track-smoke focus:outline-none focus:border-track-flame transition"
            />
          </label>

          <Dropzone
            label="Add reference photos"
            helper="25–40 images of one photographer's style works best."
            onFiles={addFiles}
            disabled={state.kind === "building"}
          />

          {files.length > 0 ? (
            <FileList
              files={files}
              onRemove={state.kind === "building" ? undefined : removeFile}
            />
          ) : null}

          {state.kind === "building" ? (
            <Progress
              value={state.processed}
              max={state.total}
              label={phaseLabel(state.phase)}
            />
          ) : null}

          {state.kind === "error" ? (
            <p className="text-sm text-track-flame">
              {state.message}
            </p>
          ) : null}

          <PrimaryButton
            onClick={startBuild}
            disabled={files.length === 0 || state.kind === "building"}
            loading={state.kind === "building"}
          >
            {buildButtonLabel}
          </PrimaryButton>
        </section>

        <section className="text-xs text-track-steel space-y-2 pt-4 border-t border-track-smoke">
          <p>
            All processing happens in your browser. Photos never leave your device.
          </p>
          <p>
            <strong className="text-track-chalk">To use the .xmp:</strong>{" "}
            download → open Lightroom Mobile → Presets → ⋯ → Import preset.
          </p>
        </section>
      </main>
    </div>
  );
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
