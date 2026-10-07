import { useSyncExternalStore } from 'react';

export interface ExecutionStats {
  /** Raw `queryInfo.execution_time`. */
  executionTime?: number | string | null;
  /** Raw `resource_usage.cpu['total cpu']`. */
  cpuUsage?: string | null;
  /** Bytes (`memory.peak_per_node`). */
  memoryUsage?: number | string | null;
}

/** Bytes to whole MB; null when absent/zero/not a number. */
export function formatMemoryMb(bytes: number | string | null | undefined): string | null {
  const n = typeof bytes === 'string' ? Number(bytes) : bytes;
  if (!n || !Number.isFinite(n)) return null;
  return `${Math.round(n / 1024 / 1024)}MB`;
}

export interface StatusItem {
  label: string;
  value: string;
}

/** The rows the Execution status panel shows: time always (when known), CPU and memory when present. */
export function formatExecutionStats(stats: ExecutionStats): StatusItem[] {
  const items: StatusItem[] = [];
  const t = stats.executionTime;
  if (t !== null && t !== undefined && t !== '')
    items.push({ label: 'Execution Time', value: String(t) });
  if (stats.cpuUsage) items.push({ label: 'CPU Time', value: String(stats.cpuUsage) });
  const mem = formatMemoryMb(stats.memoryUsage);
  if (mem) items.push({ label: 'Memory', value: mem });
  return items;
}

/** Tiny external store so the AG Grid status panel (rendered by the grid) stays reactive. */
export interface StatsStore {
  get(): ExecutionStats;
  set(next: ExecutionStats): void;
  subscribe(listener: () => void): () => void;
}

export function createStatsStore(initial: ExecutionStats = {}): StatsStore {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set(next) {
      if (
        next.executionTime === current.executionTime &&
        next.cpuUsage === current.cpuUsage &&
        next.memoryUsage === current.memoryUsage
      )
        return;
      current = next;
      listeners.forEach((l) => l());
    },
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

export function useStats(store: StatsStore | undefined): ExecutionStats {
  return useSyncExternalStore(
    (l) => store?.subscribe(l) ?? (() => undefined),
    () => store?.get() ?? EMPTY,
  );
}
const EMPTY: ExecutionStats = {};
