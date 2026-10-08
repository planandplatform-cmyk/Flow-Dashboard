/**
 * Step timings for one page render, shown to FFM staff with ?timing=1 so a
 * slow report can be diagnosed from a screenshot.
 */
export interface Timer {
  steps: { label: string; ms: number }[];
  /** Time a promise and record it under `label`. */
  time<T>(label: string, work: Promise<T> | (() => Promise<T>)): Promise<T>;
  /** Record the time since the last mark. */
  mark(label: string): void;
  /** Milliseconds since the timer was created. */
  total(): number;
}

export function createTimer(): Timer {
  const created = performance.now();
  let last = created;
  const steps: Timer["steps"] = [];
  return {
    steps,
    async time(label, work) {
      const start = performance.now();
      try {
        return await (typeof work === "function" ? work() : work);
      } finally {
        steps.push({ label, ms: Math.round(performance.now() - start) });
        last = performance.now();
      }
    },
    total: () => Math.round(performance.now() - created),
    mark(label) {
      const now = performance.now();
      steps.push({ label, ms: Math.round(now - last) });
      last = now;
    },
  };
}
