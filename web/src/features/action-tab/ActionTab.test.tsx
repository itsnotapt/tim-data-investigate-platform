import 'fake-indexeddb/auto';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogueAction, Instance, Run } from '../../lib/api';
import { useInstanceStore } from '../instance';
import type { TabState } from '../tabs';
import { useTabsStore } from '../tabs/tabStore';
import { ActionTab } from './ActionTab';

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

function setup(state: Partial<TabState> = {}, key = 'dev-sign-ins') {
  const uuid = useTabsStore.getState().createTab({
    componentName: 'ActionResult',
    parentUuid: null,
    title: 'Sign-ins for alice',
    params: { action: key, params: { users: ['alice'] } },
    state,
  });
  const onRun = vi.fn();
  render(
    <MemoryRouter>
      <ActionTab uuid={uuid} onRun={onRun} />
    </MemoryRouter>,
  );
  return { uuid, onRun };
}

beforeEach(() => {
  useTabsStore.reset();
  useInstanceStore.setState({ instance });
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

  it('shows the run going instead of Run', () => {
    setup({ isExecuting: true });
    expect(screen.queryByRole('button', { name: 'Run' })).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Running' })).toBeInTheDocument();
  });

  it('shows a message instead of an empty grid when the run succeeded with no rows', () => {
    setup({ run: succeeded, resultsRunId: 'r1', rowCount: 0 });
    expect(screen.getByRole('tab', { name: 'Results · 0' })).toBeInTheDocument();
    expect(screen.getByText('The run succeeded with no rows.')).toBeInTheDocument();
    expect(screen.queryByTestId('results-grid')).not.toBeInTheDocument();
  });

  it('shows why the run failed', () => {
    setup({ error: { message: 'Results are no longer available; run again' } });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Results are no longer available; run again',
    );
  });

  it('says so when the action is no longer in the instance, and cannot run', () => {
    setup({}, 'gone');
    expect(screen.getByText('This action is no longer available.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
  });
});
