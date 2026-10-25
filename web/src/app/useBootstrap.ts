import { useCallback, useContext, useEffect, useState } from 'react';
import { NotifyContext, type Notify } from '../components/notifyContext';
import { loadAppliedViews } from '../features/action-column-views';
import { resumeActionRuns } from '../features/action-tab';
import { refreshInstanceOnFocus, useInstanceStore } from '../features/instance';
import { resumeSinkRuns } from '../features/sinks';
import { useTabsStore } from '../features/tabs';
import { startAnnotationSync } from '../lib/annotations';
import { useAuth } from '../lib/auth';
import { loadColumnViews } from './columnViewsState';

type BootstrapStatus = 'signedOut' | 'loading' | 'loaded' | 'error';

export interface BootstrapSteps {
  loadInstance: () => Promise<void>;
  /** The Kusto tabs' column views, and the analyst's applied views. */
  loadColumnViews: (analyst: string) => Promise<void>;
  loadTabs: () => Promise<void>;
  /** Picks up the runs the loaded tabs were following. */
  resumeRuns: () => void;
  /** Picks up the sink runs the page was following before a reload, toasting how they end. */
  resumeSinkRuns: (notify: Notify) => void;
  /** Refetches the instance on window focus while loaded; returns the cleanup. */
  watchInstance: () => () => void;
  /** Starts reading the annotation change feed while loaded; returns the stop. */
  syncAnnotations: () => () => void;
}

async function loadTabs(): Promise<void> {
  const store = useTabsStore.getState();
  await store.load();
  const { loadError } = useTabsStore.getState();
  if (loadError) throw new Error(loadError);
}

const defaultSteps: BootstrapSteps = {
  loadInstance: () => useInstanceStore.getState().load(),
  loadColumnViews: async (analyst) => {
    await loadColumnViews();
    await loadAppliedViews(analyst);
  },
  loadTabs,
  resumeRuns: () => void resumeActionRuns(),
  resumeSinkRuns: (notify) => void resumeSinkRuns({ notify }),
  watchInstance: () => refreshInstanceOnFocus(useInstanceStore),
  syncAnnotations: () =>
    startAnnotationSync(useInstanceStore.getState().instance?.limits.annotationPollSeconds ?? 30),
};

export interface UseBootstrap {
  status: BootstrapStatus;
  /** Sign-in or data-load failure (e.g. `interaction_in_progress`). */
  error: Error | null;
  /** Sign-in: starts a fresh login attempt. */
  login: () => Promise<void>;
  /** Retry after a failure: a fresh sign-in if sign-in failed, else re-runs the load steps. */
  retry: () => void;
}

/**
 * Startup sequence: sign in, then the instance, column views and tabs, then the tabs'
 * runs and the sink runs are picked up again.
 * A failed attempt leaves the app retryable.
 */
export function useBootstrap(steps: BootstrapSteps = defaultSteps): UseBootstrap {
  const auth = useAuth();
  const notifyContext = useContext(NotifyContext);
  const signedIn = auth.status === 'signedIn';
  const analyst = auth.account?.name ?? null;
  const [attempt, setAttempt] = useState(0);
  // Result of the run for `attempt`; a result of an older attempt counts as still loading.
  const [result, setResult] = useState<{
    attempt: number;
    status: 'loaded' | 'error';
    error: Error | null;
  } | null>(null);

  useEffect(() => {
    if (!signedIn || !analyst) return;
    let cancelled = false;
    void (async () => {
      try {
        await steps.loadInstance();
        await steps.loadColumnViews(analyst);
        await steps.loadTabs();
        if (!cancelled) steps.resumeRuns();
        if (!cancelled) steps.resumeSinkRuns((options) => notifyContext?.(options));
        if (!cancelled) setResult({ attempt, status: 'loaded', error: null });
      } catch (e) {
        console.error(e);
        if (!cancelled) {
          setResult({
            attempt,
            status: 'error',
            error: e instanceof Error ? e : new Error(String(e)),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // `steps` is expected to be stable (module constant or memoised).
  }, [signedIn, analyst, attempt, steps, notifyContext]);

  const loaded = signedIn && result?.attempt === attempt && result.status === 'loaded';
  useEffect(() => (loaded ? steps.watchInstance() : undefined), [loaded, steps]);
  useEffect(() => (loaded ? steps.syncAnnotations() : undefined), [loaded, steps]);

  const { login } = auth;
  const retry = useCallback(() => {
    if (!signedIn) void login();
    else setAttempt((n) => n + 1);
  }, [signedIn, login]);

  if (auth.status === 'signedOut') {
    return { status: 'signedOut', error: null, login, retry };
  }
  if (auth.status === 'error') return { status: 'error', error: auth.error, login, retry };
  if (auth.status === 'loading') return { status: 'loading', error: null, login, retry };
  if (result?.attempt !== attempt) return { status: 'loading', error: null, login, retry };
  return { status: result.status, error: result.error, login, retry };
}
