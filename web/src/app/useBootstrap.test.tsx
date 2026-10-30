import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SnackbarHost } from '../components/SnackbarHost';
import type { Notify } from '../components/notifyContext';
import { AuthClientError, AuthProvider, type AuthAccount, type AuthClient } from '../lib/auth';
import { AuthGate } from './AuthGate';
import type { BootstrapSteps } from './useBootstrap';

const ACCOUNT: AuthAccount = { id: 'u', name: 'jo@example.com', tenantId: 't' };

const client = (over: Partial<AuthClient> = {}): AuthClient => ({
  getAccount: vi.fn().mockResolvedValue(ACCOUNT),
  acquireToken: vi.fn().mockResolvedValue('tok'),
  login: vi.fn().mockResolvedValue(ACCOUNT),
  logout: vi.fn().mockResolvedValue(undefined),
  ...over,
});

function setup(authClient: AuthClient, steps: BootstrapSteps) {
  render(
    <SnackbarHost>
      <AuthProvider client={authClient}>
        <AuthGate steps={steps}>
          <p>app ready</p>
        </AuthGate>
      </AuthProvider>
    </SnackbarHost>,
  );
}

function makeSteps(calls: string[] = []) {
  const step = (name: string) => vi.fn(() => Promise.resolve().then(() => void calls.push(name)));
  return {
    calls,
    steps: {
      loadAnalyst: step('analyst'),
      loadInstance: step('instance'),
      loadDefaultViews: step('defaultViews'),
      loadTabs: step('tabs'),
      resumeRuns: vi.fn(() => void calls.push('resumeRuns')),
      resumeSinkRuns: vi.fn<(notify: Notify) => void>(() => void calls.push('resumeSinkRuns')),
      watchInstance: vi.fn(() => {
        calls.push('watchInstance');
        return () => void calls.push('unwatchInstance');
      }),
      syncAnnotations: vi.fn(() => {
        calls.push('syncAnnotations');
        return () => void calls.push('unsyncAnnotations');
      }),
    } satisfies BootstrapSteps,
  };
}

describe('useBootstrap', () => {
  it('runs analyst, instance, default views, tabs in order, then loaded', async () => {
    const { steps, calls } = makeSteps();
    setup(client(), steps);
    expect(screen.getByText('Authenticating and loading...')).toBeInTheDocument();
    expect(await screen.findByText('app ready')).toBeInTheDocument();
    // The instance is watched from an effect once loaded, which can run after the loaded render.
    await waitFor(() =>
      expect(calls).toEqual([
        'analyst',
        'instance',
        'defaultViews',
        'tabs',
        'resumeRuns',
        'resumeSinkRuns',
        'watchInstance',
        'syncAnnotations',
      ]),
    );
    expect(steps.loadDefaultViews).toHaveBeenCalledWith('jo@example.com');
  });

  it("picks the sink runs up again, toasting how they ended in the app's snackbar", async () => {
    const { steps } = makeSteps();
    setup(client(), steps);
    expect(await screen.findByText('app ready')).toBeInTheDocument();
    expect(steps.resumeSinkRuns).toHaveBeenCalledTimes(1);
    const [notify] = steps.resumeSinkRuns.mock.calls[0]!;
    act(() => notify('Save event: 2 rows'));
    expect(await screen.findByText('Save event: 2 rows')).toBeInTheDocument();
  });

  it('does not load anything while signed out', async () => {
    const { steps } = makeSteps();
    setup(client({ getAccount: vi.fn().mockResolvedValue(null) }), steps);
    expect(await screen.findByText(/You must/)).toBeInTheDocument();
    expect(steps.loadInstance).not.toHaveBeenCalled();
  });

  it('failed first sign-in then retry proceeds to loaded', async () => {
    const { steps } = makeSteps();
    const login = vi
      .fn()
      .mockRejectedValueOnce(new AuthClientError('interaction_in_progress'))
      .mockResolvedValueOnce(ACCOUNT);
    setup(client({ getAccount: vi.fn().mockResolvedValue(null), login }), steps);
    await userEvent.click(await screen.findByRole('button', { name: 'sign-in' }));
    expect(await screen.findByText(/abnormal state/)).toBeInTheDocument();
    expect(steps.loadInstance).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('app ready')).toBeInTheDocument();
    expect(login).toHaveBeenCalledTimes(2);
    expect(steps.loadTabs).toHaveBeenCalledTimes(1);
  });

  it('a failing load step shows the error; Retry re-runs and reaches loaded', async () => {
    const { steps } = makeSteps();
    steps.loadDefaultViews.mockRejectedValueOnce(new Error('idb unavailable'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    setup(client(), steps);
    expect(await screen.findByText('idb unavailable')).toBeInTheDocument();
    expect(screen.queryByText('app ready')).not.toBeInTheDocument();
    expect(steps.loadTabs).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('app ready')).toBeInTheDocument();
    expect(steps.loadInstance).toHaveBeenCalledTimes(2);
    expect(steps.loadTabs).toHaveBeenCalledTimes(1);
  });

  it('a failing analyst load shows the error, and Retry loads the analyst again', async () => {
    const { steps } = makeSteps();
    steps.loadAnalyst.mockRejectedValueOnce(new Error('api unreachable'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    setup(client(), steps);
    expect(await screen.findByText('api unreachable')).toBeInTheDocument();
    expect(steps.loadInstance).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('app ready')).toBeInTheDocument();
    expect(steps.loadAnalyst).toHaveBeenCalledTimes(2);
  });
});
