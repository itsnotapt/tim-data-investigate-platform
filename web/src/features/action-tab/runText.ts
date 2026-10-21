import type { Run, RunStatus } from '../../lib/api';

/** A duration in seconds as words: "2.5 s", "2 min 5 s", "1 h 3 min". */
export function durationText(seconds: number): string {
  if (seconds < 60) return `${Number(seconds.toFixed(1))} s`;
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min ${whole % 60} s`;
}

/** A run's status as the Run tab names it; a succeeded run with no rows says so. */
export function statusText(status: RunStatus, rowCount?: number | null): string {
  switch (status) {
    case 'running':
      return 'Running';
    case 'succeeded':
      return rowCount === 0 ? 'Succeeded, no rows' : 'Succeeded';
    case 'error':
      return 'Error';
    case 'timedOut':
      return 'Timed out';
    case 'cancelled':
      return 'Cancelled';
  }
}

/** How the latest run ended, for the note over the last good results. */
export function outcomeText(run: Run | null | undefined): string {
  switch (run?.status) {
    case undefined:
      return 'The last run could not start.';
    case 'error':
      return 'The last run failed.';
    case 'timedOut':
      return 'The last run timed out.';
    case 'cancelled':
      return 'The last run was cancelled.';
    default:
      return 'The last run’s results could not be loaded.';
  }
}
