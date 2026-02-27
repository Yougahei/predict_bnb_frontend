export function formatTs(ts: number | null | undefined): string {
  if (!ts) return "--";
  // If ts is small (seconds), multiply by 1000. If large (ms), keep as is.
  // Heuristic: year 2000 in seconds is ~946,000,000. Year 3000 is ~32,000,000,000.
  // Timestamps in ms are usually > 1,000,000,000,000.
  const time = ts < 10000000000 ? ts * 1000 : ts;
  const d = new Date(time);
  return d.toLocaleString();
}

export function formatNumber(value: number | null | undefined, digits = 4): string {
  if (value == null || Number.isNaN(value)) return "--";
  return value.toFixed(digits);
}
