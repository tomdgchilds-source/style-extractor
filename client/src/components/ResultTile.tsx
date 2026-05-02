import { useEffect, useState, type ChangeEvent } from "react";
import { BeforeAfter } from "./BeforeAfter";

type ResultTileProps = {
  fileName: string;
  beforeUrl: string;
  afterUrl: string;
  width: number;
  height: number;
  strength: number;
  isReprocessing?: boolean;
  onStrengthChange: (next: number) => void;
  onReprocess: () => void;
  onDownload: () => void;
  onRemove: () => void;
};

export function ResultTile({
  fileName,
  beforeUrl,
  afterUrl,
  width,
  height,
  strength,
  isReprocessing = false,
  onStrengthChange,
  onReprocess,
  onDownload,
  onRemove,
}: ResultTileProps) {
  const [draftStrength, setDraftStrength] = useState<number>(strength);

  useEffect(() => {
    setDraftStrength(strength);
  }, [strength]);

  const handleDraftChange = (e: ChangeEvent<HTMLInputElement>) => {
    const next = Number(e.target.value) / 100;
    setDraftStrength(next);
  };

  const commit = () => {
    if (draftStrength !== strength) {
      onStrengthChange(draftStrength);
    }
  };

  const displayPercent = Math.round(draftStrength * 100);

  return (
    <article className="rounded-2xl bg-track-ink border border-track-smoke p-4 space-y-4">
      <header className="flex items-center justify-between gap-3">
        <h3
          className="text-sm font-semibold text-track-chalk truncate min-w-0"
          title={fileName}
        >
          {fileName}
        </h3>
        <span className="text-xs text-track-steel shrink-0 tabular-nums">
          {width} × {height}
        </span>
      </header>

      <BeforeAfter beforeSrc={beforeUrl} afterSrc={afterUrl} />

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label
            htmlFor={`strength-${fileName}`}
            className="text-xs uppercase tracking-wider text-track-steel"
          >
            Strength
          </label>
          <span className="text-xs text-track-chalk font-semibold tabular-nums">
            {displayPercent}%
          </span>
        </div>
        <input
          id={`strength-${fileName}`}
          type="range"
          min={0}
          max={100}
          step={1}
          value={displayPercent}
          onChange={handleDraftChange}
          onPointerUp={commit}
          onTouchEnd={commit}
          onKeyUp={commit}
          aria-label="Filter strength"
          className="rt-strength w-full h-7 appearance-none bg-transparent cursor-pointer
            [&::-webkit-slider-runnable-track]:h-1.5
            [&::-webkit-slider-runnable-track]:rounded-full
            [&::-webkit-slider-runnable-track]:bg-track-smoke
            [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:h-7
            [&::-webkit-slider-thumb]:w-7
            [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:bg-track-flame
            [&::-webkit-slider-thumb]:border-2
            [&::-webkit-slider-thumb]:border-track-asphalt
            [&::-webkit-slider-thumb]:-mt-[10px]
            [&::-webkit-slider-thumb]:cursor-pointer
            [&::-moz-range-track]:h-1.5
            [&::-moz-range-track]:rounded-full
            [&::-moz-range-track]:bg-track-smoke
            [&::-moz-range-thumb]:h-7
            [&::-moz-range-thumb]:w-7
            [&::-moz-range-thumb]:rounded-full
            [&::-moz-range-thumb]:bg-track-flame
            [&::-moz-range-thumb]:border-2
            [&::-moz-range-thumb]:border-track-asphalt
            [&::-moz-range-thumb]:cursor-pointer
            focus:outline-none"
        />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={onReprocess}
          disabled={isReprocessing}
          aria-busy={isReprocessing || undefined}
          aria-label="Reprocess"
          className="inline-flex items-center justify-center min-h-12 px-3 rounded-xl bg-track-smoke text-track-chalk border border-track-smoke hover:border-track-flame text-xs font-bold uppercase tracking-tight transition-colors duration-100 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
        >
          {isReprocessing ? (
            <span
              className="inline-block h-4 w-4 rounded-full border-2 border-track-chalk border-t-transparent animate-spin"
              aria-hidden="true"
            />
          ) : (
            <span>Reprocess</span>
          )}
        </button>
        <button
          type="button"
          onClick={onDownload}
          aria-label="Download"
          className="inline-flex items-center justify-center min-h-12 px-3 rounded-xl bg-track-flame text-track-asphalt text-xs font-bold uppercase tracking-tight transition-transform duration-100 active:scale-[0.97]"
        >
          Download
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove"
          className="inline-flex items-center justify-center min-h-12 px-3 rounded-xl bg-transparent text-track-steel border border-track-smoke hover:text-track-flame hover:border-track-flame text-xs font-bold uppercase tracking-tight transition-colors duration-100 active:scale-[0.97]"
        >
          Remove
        </button>
      </div>
    </article>
  );
}
