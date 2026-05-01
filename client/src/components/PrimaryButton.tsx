import type { ButtonHTMLAttributes } from "react";

type PrimaryButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
};

export function PrimaryButton({
  loading = false,
  disabled,
  children,
  className,
  type,
  onClick,
  ...rest
}: PrimaryButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      {...rest}
      type={type ?? "button"}
      disabled={isDisabled}
      onClick={isDisabled ? undefined : onClick}
      aria-busy={loading || undefined}
      className={`inline-flex w-full sm:w-auto items-center justify-center gap-2 min-h-14 px-6 rounded-xl bg-track-flame text-track-asphalt font-bold tracking-tight uppercase text-sm transition-transform duration-100 ease-out active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 ${
        className ?? ""
      }`}
    >
      {loading ? (
        <span
          className="inline-block h-4 w-4 rounded-full border-2 border-track-asphalt border-t-transparent animate-spin"
          aria-hidden="true"
        />
      ) : null}
      <span>{children}</span>
    </button>
  );
}
