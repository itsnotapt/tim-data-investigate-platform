import { useCallback, useEffect, useState } from 'react';
import { useTabsStore } from '../features/tabs';
import { useTemplatesStore } from '../features/templates';
import { useAuth } from '../lib/auth';
import { loadColumnViews } from './columnViewsState';

export type BootstrapStatus = 'signedOut' | 'loading' | 'loaded' | 'error';

export interface BootstrapSteps {
  loadTemplates: () => Promise<void>;
  loadColumnViews: () => Promise<void>;
  loadTabs: () => Promise<void>;
}

async function loadTabs(): Promise<void> {
  const store = useTabsStore.getState();
  await store.load();
  const { loadError } = useTabsStore.getState();
  if (loadError) throw new Error(loadError);
}

export const defaultSteps: BootstrapSteps = {
  loadTemplates: () => useTemplatesStore.getState().load(),
  loadColumnViews,
  loadTabs,
};

export interface UseBootstrap {
  status: BootstrapStatus;
  /** Sign-in or data-load failure (legacy texts, incl. `interaction_in_progress`). */
  error: Error | null;
  /** Sign-in: starts a fresh login attempt. */
  login: () => Promise<void>;
  /** Retry after a failure: a fresh sign-in if sign-in failed, else re-runs the load steps. */
  retry: () => void;
}

/**
 * Startup sequence (legacy `App.vue` runSetup): sign in, then templates, column views and tabs.
 * BUG-22: a failed attempt leaves the app retryable instead of stuck.
 */
export function useBootstrap(steps: BootstrapSteps = defaultSteps): UseBootstrap {
  const auth = useAuth();
  const signedIn = auth.status === 'signedIn';
  const [attempt, setAttempt] = useState(0);
  // Result of the run for `attempt`; a result of an older attempt counts as still loading.
  const [result, setResult] = useState<{
    attempt: number;
    status: 'loaded' | 'error';
    error: Error | null;
  } | null>(null);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    void (async () => {
      try {
        await steps.loadTemplates();
        await steps.loadColumnViews();
        await steps.loadTabs();
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
  }, [signedIn, attempt, steps]);

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
