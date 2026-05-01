import { useEffect, useRef, useState, type ChangeEvent } from "react";

type BeforeAfterProps = {
  beforeSrc: string;
  afterSrc: string;
  label?: string;
};

export function BeforeAfter({ beforeSrc, afterSrc, label }: BeforeAfterProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(50);
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined);

  useEffect(() => {
    const computeMax = () => {
      // Fit comfortably within the viewport on phones (leave room for header + controls).
      const vh = typeof window !== "undefined" ? window.innerHeight : 800;
      setMaxHeight(Math.max(240, Math.round(vh * 0.65)));
    };
    computeMax();
    window.addEventListener("resize", computeMax);
    return () => window.removeEventListener("resize", computeMax);
  }, []);

  const handleRange = (e: ChangeEvent<HTMLInputElement>) => {
    setPosition(Number(e.target.value));
  };

  return (
    <figure className="w-full">
      {label ? (
        <figcaption className="text-xs uppercase tracking-wider text-track-steel mb-2">
          {label}
        </figcaption>
      ) : null}
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded-2xl bg-track-smoke select-none"
        style={maxHeight ? { maxHeight: `${maxHeight}px` } : undefined}
      >
        <img
          src={beforeSrc}
          alt="Before"
          className="block w-full h-auto object-contain"
          draggable={false}
        />
        <img
          src={afterSrc}
          alt="After"
          className="absolute inset-0 block w-full h-full object-contain"
          draggable={false}
          style={{ clipPath: `inset(0 0 0 ${position}%)` }}
        />
        <div
          className="pointer-events-none absolute inset-y-0 w-px bg-track-flame"
          style={{ left: `${position}%` }}
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-track-asphalt border-2 border-track-flame shadow-lg"
          style={{ left: `${position}%` }}
          aria-hidden="true"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4 text-track-flame"
          >
            <path d="m9 18-6-6 6-6" />
            <path d="m15 6 6 6-6 6" />
          </svg>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={0.1}
          value={position}
          onChange={handleRange}
          aria-label="Reveal before vs after"
          className="ba-range absolute inset-0 w-full h-full appearance-none bg-transparent cursor-ew-resize"
        />
      </div>
      <style>{`
        .ba-range::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 44px;
          height: 44px;
          background: transparent;
          border: 0;
          cursor: ew-resize;
        }
        .ba-range::-moz-range-thumb {
          width: 44px;
          height: 44px;
          background: transparent;
          border: 0;
          cursor: ew-resize;
        }
        .ba-range::-webkit-slider-runnable-track {
          background: transparent;
          height: 100%;
        }
        .ba-range::-moz-range-track {
          background: transparent;
          height: 100%;
        }
        .ba-range:focus {
          outline: none;
        }
      `}</style>
    </figure>
  );
}
