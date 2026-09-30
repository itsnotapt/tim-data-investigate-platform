import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SnackbarHost } from '../../components/SnackbarHost';
import { resetConfigCache } from '../../lib/config/runtimeConfig';
import { useTabsStore } from '../tabs/tabStore';
import { KustoQueryTab } from './KustoQueryTab';
import { DEFAULT_QUERY_EXAMPLE } from './defaultQuery';

// Use an in-memory tab store so nothing touches IndexedDB.
vi.mock('../tabs/tabStore', async (importOriginal) => {
  const m = await importOriginal<typeof import('../tabs/tabStore')>();
  const store = m.createTabsStore({
    persistence: {
      loadAll: () => Promise.resolve([]),
      save: () => Promise.resolve(),
      remove: () => Promise.resolve(),
    },
    debounceMs: 1,
  });
  return { ...m, useTabsStore: store };
});

// Monaco cannot run in jsdom.
vi.mock('../../components/CodeEditor', () => ({
  CodeEditor: ({
    value,
    onChange,
    ariaLabel,
  }: {
    value: string;
    onChange?: (v: string) => void;
    ariaLabel?: string;
  }) => (
    <textarea aria-label={ariaLabel} value={value} onChange={(e) => onChange?.(e.target.value)} />
  ),
}));

const Loc = () => <div data-testid="loc">{useLocation().pathname}</div>;

function setup(
  onRun = vi.fn(),
  params = { query: DEFAULT_QUERY_EXAMPLE, cluster: '', database: '' },
) {
  const uuid = useTabsStore.getState().createTab({
    componentName: 'KustoQueryResult',
    parentUuid: null,
    title: 'New query',
    params,
  });
  render(
    <SnackbarHost>
      <MemoryRouter initialEntries={[`/view/${uuid}`]}>
        <Routes>
          <Route path="/view/:uuid" element={<KustoQueryTab uuid={uuid} onRun={onRun} />} />
        </Routes>
        <Loc />
      </MemoryRouter>
    </SnackbarHost>,
  );
  return { uuid, onRun, user: userEvent.setup() };
}

const tab = (uuid: string) => {
  const t = useTabsStore.getState().tabs[uuid];
  if (t?.componentName !== 'KustoQueryResult') throw new Error('missing');
  return t;
};

beforeEach(() => {
  useTabsStore.reset();
  window.appConfig = {
    auth: { clientId: 'id', authority: 'https://login.example.com/t' },
    redirectUri: 'https://tim.example.com/blank.html',
    tagCluster: 'https://tags.kusto.windows.net',
    defaultClusters: [
      { name: 'Example', clusters: ['https://help.kusto.windows.net'], databases: ['Samples'] },
    ],
  };
  resetConfigCache();
});
afterEach(() => {
  delete window.appConfig;
  resetConfigCache();
});

describe('KustoQueryTab', () => {
  it('opens a new draft in edit mode with the default query', () => {
    setup();
    expect(screen.getByLabelText('Summary')).toHaveValue('New query');
    expect(screen.getByLabelText('Query')).toHaveValue(DEFAULT_QUERY_EXAMPLE);
    expect(screen.getByRole('button', { name: 'Run Query' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clone' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Save Changes & Run/ })).toBeInTheDocument();
  });

  it('requires cluster and database before saving', async () => {
    const { uuid, user, onRun } = setup();
    await user.click(screen.getByRole('button', { name: /Save Changes & Run/ }));
    expect(screen.getByText('Cluster is required')).toBeInTheDocument();
    expect(screen.getByText('Database is required')).toBeInTheDocument();
    expect(onRun).not.toHaveBeenCalled();
    expect(tab(uuid).params.cluster).toBe('');
  });

  it('Save stores title and params, leaves edit mode and does not run', async () => {
    const { uuid, user, onRun } = setup();
    await user.clear(screen.getByLabelText('Summary'));
    await user.type(screen.getByLabelText('Summary'), 'Mine');
    await user.type(screen.getByRole('combobox', { name: /Cluster/ }), 'contoso');
    await user.type(screen.getByRole('combobox', { name: /Database/ }), 'Db');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(tab(uuid).title).toBe('Mine');
    // Normalised on blur (no forced .kusto.windows.net, BUG-29).
    expect(tab(uuid).params).toMatchObject({ cluster: 'https://contoso', database: 'Db' });
    expect(screen.queryByLabelText('Summary')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Query' })).toBeInTheDocument();
    expect(onRun).not.toHaveBeenCalled();
  });

  it('Save & Run saves then runs with the time range', async () => {
    const { uuid, user, onRun } = setup(vi.fn(), {
      query: 'T',
      cluster: 'https://c',
      database: 'd',
    });
    await user.click(screen.getByRole('button', { name: /Save Changes & Run/ }));
    expect(onRun).toHaveBeenCalledWith({
      uuid,
      timeRange: expect.objectContaining({ kind: 'relative' }) as unknown,
    });
    expect(screen.queryByLabelText('Summary')).not.toBeInTheDocument();
  });

  it('Cancel discards edits', async () => {
    const { uuid, user } = setup(vi.fn(), { query: 'T', cluster: 'https://c', database: 'd' });
    await user.type(screen.getByLabelText('Summary'), ' edited');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(tab(uuid).title).toBe('New query');
    await user.click(screen.getByRole('button', { name: 'Edit Query' }));
    expect(screen.getByLabelText('Summary')).toHaveValue('New query');
  });

  it('Run Query runs in view mode; the time range is persisted in tab state', async () => {
    const { uuid, user, onRun } = setup(vi.fn(), {
      query: 'T',
      cluster: 'https://c',
      database: 'd',
    });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: /Time range: Last 15 minutes/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Last 7 days' }));
    expect(tab(uuid).state.timeRange).toMatchObject({ kind: 'relative', start: { amount: 7 } });
    await user.click(screen.getByRole('button', { name: 'Run Query' }));
    expect(onRun).toHaveBeenCalledWith(
      expect.objectContaining({ timeRange: tab(uuid).state.timeRange }),
    );
  });

  it('Clone creates a root "Copy of" tab and navigates to it', async () => {
    const params = { query: 'T | take 1', cluster: 'https://c', database: 'd' };
    const { uuid, user } = setup(vi.fn(), params);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Clone' }));
    const { tabs, order } = useTabsStore.getState();
    const copyId = order.find((id) => id !== uuid);
    const copy = copyId ? tabs[copyId] : undefined;
    expect(copy).toMatchObject({ title: 'Copy of New query', parentUuid: null, params });
    expect(screen.getByTestId('loc')).toHaveTextContent(`/view/${copyId}`);
  });

  it('shows the stored error and opens Query Help', async () => {
    const { uuid, user } = setup();
    useTabsStore.getState().updateState(uuid, { error: new Error('Boom') });
    expect(await screen.findByText('Boom')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Query Help' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Required Fields')).toBeInTheDocument();
  });
});
