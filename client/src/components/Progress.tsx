type ProgressProps = {
  value: number;
  max?: number;
  label?: string;
};

export function Progress({ value, max = 100, label }: ProgressProps) {
  const safeMax = max <= 0 ? 100 : max;
  const ratio = Math.min(1, Math.max(0, value / safeMax));
  const pct = Math.round(ratio * 100);

  return (
    <div className="w-full">
      {label ? (
        <p className="text-xs uppercase tracking-wider text-track-steel mb-2">
          {label}
        </p>
      ) : null}
      <div
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-label={label}
        className="relative h-2 w-full overflow-hidden rounded-full bg-track-smoke"
      >
        <div
          className="absolute inset-y-0 left-0 bg-track-flame transition-[width] duration-200 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-2 text-sm font-mono text-track-chalk tabular-nums">
        {pct}%
      </p>
    </div>
  );
}
