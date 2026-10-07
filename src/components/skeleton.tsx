/** Loading placeholder shown while session-dependent content streams in. */
export function ReportSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="h-16 border-b border-line bg-shell" />
      <div className="mx-auto max-w-6xl animate-pulse space-y-6 px-4 pt-8 sm:px-6">
        <div className="h-6 w-48 rounded bg-raised" />
        <div className="h-64 rounded-2xl bg-surface" />
        <div className="grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-36 rounded-xl bg-surface" />
          ))}
        </div>
      </div>
    </div>
  );
}
