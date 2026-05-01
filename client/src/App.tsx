export function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-5 pt-[env(safe-area-inset-top)] pt-6 pb-4 border-b border-track-smoke">
        <h1 className="text-xl font-semibold tracking-tight">Style Extractor</h1>
        <p className="text-sm text-track-steel mt-1">
          Drop reference photos → get a Lightroom preset.
        </p>
      </header>
      <main className="flex-1 px-5 py-6">
        <p className="text-track-steel text-sm">Scaffold up. UI lands next.</p>
      </main>
    </div>
  );
}
