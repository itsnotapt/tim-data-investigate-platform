import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
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
    <AuthProvider client={authClient}>
      <AuthGate steps={steps}>
        <p>app ready</p>
      </AuthGate>
    </AuthProvider>,
  );
}

function makeSteps(calls: string[] = []) {
  const step = (name: string) => vi.fn(() => Promise.resolve().then(() => void calls.push(name)));
  return {
    calls,
    steps: {
      loadInstance: step('instance'),
      loadTemplates: step('templates'),
      loadColumnViews: step('columnViews'),
      loadTabs: step('tabs'),
      resumeRuns: vi.fn(() => void calls.push('resumeRuns')),
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
  it('runs instance, templates, column views, tabs in order, then loaded', async () => {
    const { steps, calls } = makeSteps();
    setup(client(), steps);
    expect(screen.getByText('Authenticating and loading queries...')).toBeInTheDocument();
    expect(await screen.findByText('app ready')).toBeInTheDocument();
    // The instance is watched from an effect once loaded, which can run after the loaded render.
    await waitFor(() =>
      expect(calls).toEqual([
        'instance',
        'templates',
        'columnViews',
        'tabs',
        'resumeRuns',
        'watchInstance',
        'syncAnnotations',
      ]),
    );
  });

  it('does not load anything while signed out', async () => {
    const { steps } = makeSteps();
    setup(client({ getAccount: vi.fn().mockResolvedValue(null) }), steps);
    expect(await screen.findByText(/You must/)).toBeInTheDocument();
    expect(steps.loadTemplates).not.toHaveBeenCalled();
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
    expect(steps.loadTemplates).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('app ready')).toBeInTheDocument();
    expect(login).toHaveBeenCalledTimes(2);
    expect(steps.loadTabs).toHaveBeenCalledTimes(1);
  });

  it('a failing load step shows the error; Retry re-runs and reaches loaded', async () => {
    const { steps } = makeSteps();
    steps.loadColumnViews.mockRejectedValueOnce(new Error('idb unavailable'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    setup(client(), steps);
    expect(await screen.findByText('idb unavailable')).toBeInTheDocument();
    expect(screen.queryByText('app ready')).not.toBeInTheDocument();
    expect(steps.loadTabs).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('app ready')).toBeInTheDocument();
    expect(steps.loadTemplates).toHaveBeenCalledTimes(2);
    expect(steps.loadTabs).toHaveBeenCalledTimes(1);
  });
});
