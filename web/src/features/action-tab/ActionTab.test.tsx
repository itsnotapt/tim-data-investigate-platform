import 'fake-indexeddb/auto';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogueAction, Instance, Run } from '../../lib/api';
import { useInstanceStore } from '../instance';
import type { TabState } from '../tabs';
import { useTabsStore } from '../tabs/tabStore';
import { ActionTab } from './ActionTab';
import { runRowsStore } from './runRows';

const action: CatalogueAction = {
  key: 'dev-sign-ins',
  kind: 'query',
  name: 'Sign-ins',
  menuPath: ['Development', 'Rows'],
  connections: [],
  params: [{ name: 'users', title: 'Users', kind: 'string', required: false, many: true }],
  pivot: null,
};
const instance: Instance = {
  version: 'v1',
  actions: [action],
  connections: [],
  labels: [],
  limits: { maxResultRows: 1, maxResultBytes: 1, rowsPageSize: 10, runTimeoutSeconds: 600 },
};
const succeeded: Run = {
  runId: 'r1',
  status: 'succeeded',
  action: { key: 'dev-sign-ins', name: 'Sign-ins' },
  params: {},
  owner: 'jo@example.com',
  startedAt: '2026-10-20T10:00:00Z',
  expiresAt: '2026-10-21T10:00:00Z',
  rowCount: 0,
};

function Location() {
  return <output aria-label="Location">{useLocation().pathname}</output>;
}

function setup(state: Partial<TabState> = {}, key = 'dev-sign-ins') {
  const uuid = useTabsStore.getState().createTab({
    componentName: 'ActionResult',
    parentUuid: null,
    title: 'Sign-ins for alice',
    params: { action: key, params: { users: ['alice'] } },
    state,
  });
  const onRun = vi.fn();
  const onCancel = vi.fn();
  render(
    <MemoryRouter initialEntries={[`/view/${uuid}`]}>
      <Routes>
        <Route
          path="/view/:uuid"
          element={
            <>
              <ActionTab uuid={uuid} onRun={onRun} onCancel={onCancel} />
              <Location />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  return { uuid, onRun, onCancel };
}

const running: Run = { ...succeeded, runId: 'r2', status: 'running', rowCount: undefined };
const failed: Run = {
  ...succeeded,
  runId: 'r2',
  status: 'error',
  error: 'The sign-in log is unavailable',
  details: { duration: 2.5 },
  rowCount: undefined,
};
/** A tab whose last good run, r1, stored two rows. */
const withResults: Partial<TabState> = {
  run: { ...succeeded, rowCount: 2, details: { duration: 1 } },
  resultsRunId: 'r1',
  rowCount: 2,
  resultsStartedAt: '2026-10-20T10:00:00Z',
};
const selectedTab = () => screen.getByRole('tab', { selected: true });

beforeEach(() => {
  useTabsStore.reset();
  useInstanceStore.setState({ instance });
  runRowsStore.getState().clear();
});

describe('ActionTab', () => {
  it('shows the menu path, the action and the title', () => {
    setup();
    expect(screen.getByText('Development / Rows')).toBeInTheDocument();
    expect(screen.getByText('Sign-ins')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sign-ins for alice' })).toBeInTheDocument();
  });

  it('keeps the params edited in a pill on the tab, and runs from them', async () => {
    const { uuid, onRun } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Users: alice' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Add Users' }), 'bob{Enter}');
    await userEvent.keyboard('{Escape}');
    expect(useTabsStore.getState().tabs[uuid]?.params).toEqual({
      action: 'dev-sign-ins',
      params: { users: ['alice', 'bob'] },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(onRun).toHaveBeenCalledWith(uuid);
  });

  describe('while a run is going', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('shows a spinner with the time since the run started, and Cancel', async () => {
      vi.useFakeTimers({ now: new Date('2026-10-20T10:01:05Z'), toFake: ['Date'] });
      const { uuid, onCancel } = setup({ isExecuting: true, run: running });
      expect(screen.queryByRole('button', { name: 'Run' })).not.toBeInTheDocument();
      expect(screen.getByRole('progressbar', { name: 'Running' })).toBeInTheDocument();
      expect(screen.getByText('1 min 5 s')).toBeInTheDocument();
      vi.useRealTimers();
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(onCancel).toHaveBeenCalledWith(uuid);
    });

    it('says it is cancelling until the run ends', () => {
      setup({ isExecuting: true, run: running, cancelling: true });
      expect(screen.getByText('Cancelling…')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    });

    it('cannot cancel before the run has started', () => {
      setup({ isExecuting: true });
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    });

    it('keeps the previous results, dimmed', () => {
      setup({ ...withResults, isExecuting: true, run: running });
      expect(selectedTab()).toHaveAccessibleName('Results · 2');
      expect(screen.getByText('Showing the run from 2026-10-20 10:00:00 UTC')).toBeInTheDocument();
      expect(screen.getByRole('tabpanel', { name: 'Results · 2' })).toHaveAttribute(
        'aria-busy',
        'true',
      );
    });
  });

  it('shows a message instead of an empty grid when the run succeeded with no rows', () => {
    setup({ run: succeeded, resultsRunId: 'r1', rowCount: 0 });
    expect(screen.getByRole('tab', { name: 'Results · 0' })).toBeInTheDocument();
    expect(screen.getByText('The run succeeded with no rows.')).toBeInTheDocument();
    expect(screen.queryByTestId('results-grid')).not.toBeInTheDocument();
  });

  it('shows the Results tab after a run that succeeded', () => {
    setup(withResults);
    expect(selectedTab()).toHaveAccessibleName('Results · 2');
    expect(screen.getByRole('tab', { name: 'Run · 1 s' })).toBeInTheDocument();
    expect(screen.queryByText(/Showing the run from/)).not.toBeInTheDocument();
  });

  it.each([
    ['error', 'The run failed'],
    ['timedOut', 'The run timed out'],
    ['cancelled', 'The run was cancelled'],
  ] as const)('shows the Run tab after a run that ended %s', (status, message) => {
    setup({ run: { ...failed, status }, error: { message } });
    expect(selectedTab()).toHaveAccessibleName('Run · 2.5 s');
    expect(screen.getByRole('alert')).toHaveTextContent(message);
  });

  it('shows the Run tab when a run could not start', () => {
    setup({ error: { message: "Couldn't start: No token for the connection" } });
    expect(selectedTab()).toHaveAccessibleName('Run');
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't start: No token for the connection",
    );
  });

  it('keeps the last good results under a note after a failure', async () => {
    setup({ ...withResults, run: failed, error: { message: 'The sign-in log is unavailable' } });
    await userEvent.click(screen.getByRole('tab', { name: 'Results · 2' }));
    expect(
      screen.getByText('The last run failed. Showing the run from 2026-10-20 10:00:00 UTC'),
    ).toBeInTheDocument();
    expect(screen.getByRole('tabpanel', { name: 'Results · 2' })).not.toHaveAttribute('aria-busy');
  });

  it('says when the last run’s results could not be loaded', async () => {
    setup({
      ...withResults,
      run: { ...succeeded, runId: 'r2', rowCount: 5 },
      error: { message: 'Results are no longer available; run again' },
    });
    await userEvent.click(screen.getByRole('tab', { name: 'Results · 2' }));
    expect(
      screen.getByText(
        'The last run’s results could not be loaded. Showing the run from 2026-10-20 10:00:00 UTC',
      ),
    ).toBeInTheDocument();
  });

  it('holds the inner tab the analyst picked until the run changes', async () => {
    const { uuid } = setup(withResults);
    await userEvent.click(screen.getByRole('tab', { name: 'Run · 1 s' }));
    expect(selectedTab()).toHaveAccessibleName('Run · 1 s');
    act(() => useTabsStore.getState().updateParams(uuid, { params: { users: ['bob'] } }));
    expect(selectedTab()).toHaveAccessibleName('Run · 1 s');
    act(() => useTabsStore.getState().updateState(uuid, { isExecuting: true, run: running }));
    expect(selectedTab()).toHaveAccessibleName('Results · 2');
  });

  it('marks a param the server refused, until it is edited', async () => {
    setup({ paramErrors: { users: 'Value 1: Must be an email' } });
    const pill = screen.getByRole('button', { name: 'Users: alice' });
    expect(pill).toHaveAccessibleDescription('Value 1: Must be an email');
    await userEvent.click(pill);
    await userEvent.type(screen.getByRole('textbox', { name: 'Add Users' }), 'bob{Enter}');
    await userEvent.keyboard('{Escape}');
    expect(
      screen.getByRole('button', { name: 'Users: alice, bob' }),
    ).not.toHaveAccessibleDescription('Value 1: Must be an email');
  });

  it('shows Edited when the params differ from the last run, and resets them', async () => {
    const { uuid } = setup({ ...withResults, runParams: { users: ['alice'] } });
    expect(screen.queryByRole('button', { name: 'Edited' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Users: alice' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Add Users' }), 'bob{Enter}');
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Edited' }));
    expect(useTabsStore.getState().tabs[uuid]?.params).toMatchObject({
      params: { users: ['alice'] },
    });
    expect(screen.queryByRole('button', { name: 'Edited' })).not.toBeInTheDocument();
  });

  it('clears the marks on the pills when the params are reset', async () => {
    setup({ runParams: { users: ['bob'] }, paramErrors: { users: 'Value 1: Must be an email' } });
    await userEvent.click(screen.getByRole('button', { name: 'Edited' }));
    expect(screen.getByRole('button', { name: 'Users: bob' })).not.toHaveAccessibleDescription(
      'Value 1: Must be an email',
    );
  });

  it('clones the tab with its params, not run, and opens the copy', async () => {
    const { uuid } = setup(withResults);
    await userEvent.click(screen.getByRole('button', { name: 'Clone' }));
    const copy = Object.values(useTabsStore.getState().tabs).find((t) => t.componentUuid !== uuid);
    expect(copy).toMatchObject({
      componentName: 'ActionResult',
      parentUuid: null,
      title: 'Copy of Sign-ins for alice',
      params: { action: 'dev-sign-ins', params: { users: ['alice'] } },
      state: { rowCount: null, isExecuting: false },
    });
    expect(screen.getByRole('status', { name: 'Location' })).toHaveTextContent(
      `/view/${copy?.componentUuid}`,
    );
  });

  it('says so when the action is no longer in the instance, and cannot run', () => {
    setup({}, 'gone');
    expect(screen.getByText('This action is no longer available.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
  });

  it('shows the rows loaded so far while the rest load', async () => {
    const { uuid } = setup({ isExecuting: true, run: { ...succeeded, rowCount: 3 } });
    act(() => {
      runRowsStore
        .getState()
        .start(uuid, 'r1', [{ name: 'User', type: 'string', declared: false }], 3);
      runRowsStore.getState().append(uuid, 'r1', [
        { row: 0, id: null, data: { User: 'alice' } },
        { row: 1, id: null, data: { User: 'bob' } },
      ]);
    });
    expect(screen.getByRole('tab', { name: 'Results · 2 of 3' })).toBeInTheDocument();
    expect(await screen.findByText('bob')).toBeInTheDocument();
    act(() => {
      runRowsStore.getState().append(uuid, 'r1', [{ row: 2, id: null, data: { User: 'carol' } }]);
      runRowsStore.getState().finish(uuid, 'r1');
    });
    expect(screen.getByRole('tab', { name: 'Results · 3' })).toBeInTheDocument();
    expect(await screen.findByText('carol')).toBeInTheDocument();
  });
});
