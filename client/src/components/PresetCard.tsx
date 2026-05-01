type PresetCardProps = {
  name: string;
  createdAt: string;
  onDownloadXmp: () => void;
  onDownloadCube: () => void;
  onDelete?: () => void;
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function PresetCard({
  name,
  createdAt,
  onDownloadXmp,
  onDownloadCube,
  onDelete,
}: PresetCardProps) {
  return (
    <article className="rounded-2xl bg-track-ink border border-track-smoke p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-bold tracking-tight text-track-chalk truncate">
            {name}
          </h3>
          <p className="text-xs text-track-steel mt-1">
            {formatDate(createdAt)}
          </p>
        </div>
        {onDelete ? (
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete ${name}`}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-track-steel hover:text-track-flame hover:bg-track-smoke active:scale-95 transition"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
              aria-hidden="true"
            >
              <path d="M3 6h18" />
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <path d="m19 6-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
            </svg>
          </button>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={onDownloadXmp}
          className="flex flex-col items-center justify-center gap-1 min-h-14 rounded-xl bg-track-flame text-track-asphalt font-bold uppercase text-xs tracking-wider px-3 active:scale-[0.97] transition-transform"
        >
          <span className="text-[10px] opacity-80">Download</span>
          <span>.XMP</span>
        </button>
        <button
          type="button"
          onClick={onDownloadCube}
          className="flex flex-col items-center justify-center gap-1 min-h-14 rounded-xl bg-track-smoke text-track-chalk font-bold uppercase text-xs tracking-wider px-3 border border-track-smoke hover:border-track-flame active:scale-[0.97] transition"
        >
          <span className="text-[10px] text-track-steel">Download</span>
          <span>.CUBE</span>
        </button>
      </div>
    </article>
  );
}
