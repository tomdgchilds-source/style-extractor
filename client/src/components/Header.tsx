type HeaderProps = {
  title: string;
  subtitle?: string;
};

export function Header({ title, subtitle }: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 bg-track-asphalt/95 backdrop-blur border-b border-track-smoke pt-[env(safe-area-inset-top)]">
      <div className="px-5 pt-4 pb-4">
        <h1 className="text-xl font-bold tracking-tight text-track-chalk">
          {title}
        </h1>
        {subtitle ? (
          <p className="text-sm text-track-steel mt-1">{subtitle}</p>
        ) : null}
      </div>
    </header>
  );
}
