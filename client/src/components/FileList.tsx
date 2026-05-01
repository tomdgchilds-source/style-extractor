import { useEffect, useMemo } from "react";

type FileListProps = {
  files: File[];
  onRemove?: (index: number) => void;
};

export function FileList({ files, onRemove }: FileListProps) {
  const previews = useMemo(
    () => files.map((f) => ({ url: URL.createObjectURL(f), name: f.name })),
    [files],
  );

  useEffect(() => {
    return () => {
      for (const p of previews) URL.revokeObjectURL(p.url);
    };
  }, [previews]);

  if (files.length === 0) return null;

  return (
    <div className="-mx-5 overflow-x-auto">
      <ul className="flex gap-3 px-5 py-1">
        {previews.map((p, i) => (
          <li key={`${p.name}-${i}`} className="relative shrink-0">
            <img
              src={p.url}
              alt={p.name}
              className="h-16 w-16 rounded-xl object-cover bg-track-smoke"
              draggable={false}
            />
            {onRemove ? (
              <button
                type="button"
                onClick={() => onRemove(i)}
                aria-label={`Remove ${p.name}`}
                className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-track-asphalt border border-track-smoke text-track-chalk hover:border-track-flame hover:text-track-flame active:scale-95 transition"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-3.5 w-3.5"
                  aria-hidden="true"
                >
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
