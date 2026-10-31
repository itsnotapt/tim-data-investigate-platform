import 'fake-indexeddb/auto';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppBarSlot, AppBarSlotProvider } from '../../components/AppBarSlot';
import { SnackbarHost } from '../../components/SnackbarHost';
import type { CatalogueAction, Instance, Run } from '../../lib/api';
import { apiUrl, problemResponse } from '../../test/msw/handlers';
import { setupMswServer } from '../../test/msw/server';
import { configureTestApp, resetTestApp } from '../../test/testApp';
import { useInstanceStore } from '../instance';
import type { TabState } from '../tabs';
import { useTabsStore } from '../tabs/tabStore';
import { ActionTab } from './ActionTab';
import { runRowsStore } from './runRows';

// Monaco cannot run in jsdom.
vi.mock('../../components/CodeEditor', async () =>
  (await import('../../test/fakeCodeEditor')).fakeCodeEditorModule(),
);

const server = setupMswServer();

const action: CatalogueAction = {
  key: 'dev-sign-ins',
  kind: 'query',
  actionFile: false,
  name: 'Sign-ins',
  menuPath: ['Development', 'Rows'],
  connections: [],
  params: [{ name: 'users', title: 'Users', kind: 'string', required: false, many: true }],
  pivot: null,
};
const runKql: CatalogueAction = {
  key: 'tim.run_kql',
  kind: 'query',
  actionFile: false,
  name: 'Run KQL',
  menuPath: [],
  connections: [],
  params: [
    {
      name: 'connection',
      title: 'Connection',
      kind: 'connection',
      connectionType: 'kusto',
      required: true,
      many: false,
    },
    { name: 'database', title: 'Database', kind: 'string', required: true, many: false },
    {
      name: 'kql',
      title: 'Query',
      kind: 'kql',
      required: true,
      many: false,
      schemaFrom: ['connection', 'database'],
    },
    { name: 'parameters', title: 'Query parameters', kind: 'json', required: false, many: false },
  ],
  pivot: null,
};
const runSql: CatalogueAction = {
  key: 'tim.run_sql',
  kind: 'query',
  actionFile: false,
  name: 'Run SQL',
  menuPath: [],
  connections: [],
  params: [
    {
      name: 'connection',
      title: 'Connection',
      kind: 'connection',
      connectionType: 'snowflake',
      required: true,
      many: false,
    },
    {
      name: 'sql',
      title: 'Query',
      kind: 'sql',
      required: true,
      many: false,
      schemaFrom: ['connection'],
    },
  ],
  pivot: null,
};
const instance: Instance = {
  version: 'v1',
  actions: [action, runKql, runSql],
  connections: [{ name: 'security', type: 'kusto', title: 'Security', databases: ['Samples'] }],
  labels: [],
  limits: {
    maxResultRows: 1,
    maxResultBytes: 1,
    maxPivotRows: 100,
    rowsPageSize: 10,
    runTimeoutSeconds: 600,
    maxAnnotationIds: 10_000,
    annotationPollSeconds: 30,
  },
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

function setup(
  state: Partial<TabState> = {},
  key = 'dev-sign-ins',
  {
    params = { users: ['alice'] },
    run = true,
    shown = true,
  }: { params?: object; run?: boolean; shown?: boolean } = {},
) {
  const uuid = useTabsStore.getState().createTab({
    componentName: 'ActionResult',
    parentUuid: null,
    title: 'Sign-ins for alice',
    params: { action: key, params: params as Record<string, unknown> },
    state,
  });
  // Without `run`, Run and Cancel go to the server (msw).
  const onRun = run ? vi.fn() : undefined;
  const onCancel = run ? vi.fn() : undefined;
  // Without `shown`, another tab is on show.
  render(
    <SnackbarHost>
      <AppBarSlotProvider>
        <header>
          <AppBarSlot />
        </header>
        <MemoryRouter initialEntries={[`/view/${shown ? uuid : 'another-tab'}`]}>
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
        </MemoryRouter>
      </AppBarSlotProvider>
    </SnackbarHost>,
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
  it('shows the menu path, the action and the title in the app bar, with Save…, Clone and Copy link', () => {
    setup();
    const appBar = within(screen.getByRole('banner'));
    expect(appBar.getByText('Development / Rows')).toBeInTheDocument();
    expect(appBar.getByText('Sign-ins')).toBeInTheDocument();
    expect(appBar.getByRole('heading', { name: 'Sign-ins for alice' })).toBeInTheDocument();
    for (const name of ['Save…', 'Clone', 'Copy link'])
      expect(appBar.getByRole('button', { name })).toBeInTheDocument();
  });

  it('leaves the app bar to the tab on show', () => {
    setup({}, 'dev-sign-ins', { shown: false });
    const appBar = within(screen.getByRole('banner'));
    expect(appBar.queryByRole('heading')).not.toBeInTheDocument();
    expect(appBar.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run' })).toBeInTheDocument();
  });

  it('puts Run before the pills, so it stays put as the pills change', () => {
    setup();
    const run = screen.getByRole('button', { name: 'Run' });
    const pill = screen.getByRole('button', { name: 'Users: alice' });
    expect(run.compareDocumentPosition(pill) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows the quick filter beside the inner tabs only while the Results tab has rows', async () => {
    setup(withResults);
    const filter = screen.getByRole('textbox', { name: 'Filter rows' });
    expect(
      filter.compareDocumentPosition(screen.getByRole('tabpanel', { name: 'Results · 2' })),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    await userEvent.click(screen.getByRole('tab', { name: 'Run · 1 s' }));
    expect(screen.queryByRole('textbox', { name: 'Filter rows' })).not.toBeInTheDocument();
  });

  it('has no quick filter when the run succeeded with no rows', () => {
    setup({ run: succeeded, resultsRunId: 'r1', rowCount: 0 });
    expect(screen.queryByRole('textbox', { name: 'Filter rows' })).not.toBeInTheDocument();
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

  it('copies a link to the run whose results it shows', async () => {
    const user = userEvent.setup();
    setup(withResults);
    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(await screen.findByText('Copied a link to this result')).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe('http://localhost:3000/#/runs/r1');
  });

  it('copies a link to the run going, which fills in when it ends', async () => {
    const user = userEvent.setup();
    setup({ ...withResults, isExecuting: true, run: running });
    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(await navigator.clipboard.readText()).toBe('http://localhost:3000/#/runs/r2');
  });

  it('has no link to copy before a run', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeDisabled();
  });

  it('shows the results of a share link to an action this instance does not know, without Run', () => {
    setup({ ...withResults, linkedRow: 1 }, 'gone');
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
    expect(screen.getByRole('tab', { name: 'Results · 2', selected: true })).toBeInTheDocument();
  });

  it('shows the rows loaded so far while the rest load', async () => {
    const { uuid } = setup({ isExecuting: true, run: { ...succeeded, rowCount: 3 } });
    act(() => {
      runRowsStore
        .getState()
        .start(uuid, 'r1', [{ name: 'User', type: 'string', declared: false }], 3);
      runRowsStore.getState().append(uuid, 'r1', [
        { row: 0, data: { User: 'alice' } },
        { row: 1, data: { User: 'bob' } },
      ]);
    });
    expect(screen.getByRole('tab', { name: 'Results · 2 of 3' })).toBeInTheDocument();
    expect(await screen.findByText('bob')).toBeInTheDocument();
    act(() => {
      runRowsStore.getState().append(uuid, 'r1', [{ row: 2, data: { User: 'carol' } }]);
      runRowsStore.getState().finish(uuid, 'r1');
    });
    expect(screen.getByRole('tab', { name: 'Results · 3' })).toBeInTheDocument();
    expect(await screen.findByText('carol')).toBeInTheDocument();
  });
});

describe('ActionTab with a query param', () => {
  const kql = { connection: 'security', database: 'Samples', kql: 'StormEvents | take 2' };
  const setupKql = (state: Partial<TabState> = {}, run = true) =>
    setup(state, 'tim.run_kql', { params: kql, run });
  const kqlRun: Run = {
    ...succeeded,
    action: { key: 'tim.run_kql', name: 'Run KQL' },
    params: kql,
    rowCount: 2,
    details: { duration: 0.75 },
  };

  beforeEach(() => configureTestApp());
  afterEach(resetTestApp);

  it('edits the query in the Query tab, without a pill, and runs it on Ctrl+Enter', async () => {
    const { uuid, onRun } = setupKql();
    expect(selectedTab()).toHaveAccessibleName('Query');
    expect(screen.queryByRole('button', { name: /^Query:/ })).not.toBeInTheDocument();
    const editor = screen.getByRole('textbox', { name: 'Query' });
    await userEvent.clear(editor);
    await userEvent.type(editor, 'StormEvents | count');
    expect(useTabsStore.getState().tabs[uuid]?.params).toMatchObject({
      params: { kql: 'StormEvents | count' },
    });
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    expect(onRun).toHaveBeenCalledTimes(1);
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    expect(onRun).toHaveBeenCalledTimes(2);
  });

  it('edits KQL as Kusto and SQL as SQL', () => {
    setupKql();
    expect(screen.getByRole('textbox', { name: 'Query' })).toHaveAttribute(
      'data-language',
      'kusto',
    );
    cleanup();
    setup({}, 'tim.run_sql', { params: { connection: 'warehouse', sql: 'SELECT 1' } });
    expect(screen.getByRole('textbox', { name: 'Query' })).toHaveAttribute('data-language', 'sql');
  });

  it('greys out the only connection', () => {
    setupKql();
    expect(screen.getByRole('button', { name: 'Connection: Security' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('stays on the Query tab after a run, saying how it went, with Show results', async () => {
    server.use(
      http.post(apiUrl('/api/runs'), () => HttpResponse.json(kqlRun)),
      http.get(apiUrl('/api/runs/r1/rows'), () =>
        HttpResponse.json({
          rows: [
            { row: 0, data: { State: 'TEXAS' } },
            { row: 1, data: { State: 'IOWA' } },
          ],
          lastRow: 2,
          annotationVersion: 0,
        }),
      ),
    );
    setupKql({}, false);
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(await screen.findByText('Succeeded · 2 rows · 0.8 s')).toBeInTheDocument();
    expect(selectedTab()).toHaveAccessibleName('Query');
    await userEvent.click(screen.getByRole('button', { name: 'Show results' }));
    expect(selectedTab()).toHaveAccessibleName('Results · 2');
  });

  it('stays on the Query tab when the run could not start, with Details', async () => {
    server.use(
      http.post(apiUrl('/api/runs'), () =>
        problemResponse(403, {
          type: 'urn:tim:problem:consent-required',
          title: 'Consent required',
          detail: 'Consent or sign-in is required for the downstream service',
        }),
      ),
    );
    setupKql({}, false);
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't start: Consent or sign-in is required for the downstream service",
    );
    expect(selectedTab()).toHaveAccessibleName('Query');
    await userEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(selectedTab()).toHaveAccessibleName('Run');
  });

  it('shows why a run failed above the editor', () => {
    setupKql({
      run: { ...kqlRun, status: 'error', rowCount: undefined, error: 'Semantic error' },
      error: { message: 'Semantic error' },
    });
    expect(selectedTab()).toHaveAccessibleName('Query');
    expect(within(screen.getByRole('alert')).getByText('Semantic error')).toBeInTheDocument();
  });

  it('marks the editor when the server refuses the query, until it is edited', async () => {
    server.use(
      http.post(apiUrl('/api/runs'), () =>
        problemResponse(422, {
          type: 'urn:tim:problem:validation',
          errors: { 'params.kql': ['Must not be empty'] },
        }),
      ),
    );
    setupKql({}, false);
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));
    const editor = await screen.findByRole('group', { name: 'Query' });
    await vi.waitFor(() => expect(editor).toHaveAttribute('aria-invalid', 'true'));
    expect(editor).toHaveAccessibleDescription('Must not be empty');
    await userEvent.type(screen.getByRole('textbox', { name: 'Query' }), ' ');
    expect(editor).not.toHaveAttribute('aria-invalid');
  });

  it('shows a pill per query parameter, needed until its entry is filled in', async () => {
    const parameters = [
      { name: 'Upn', type: 'string', value: null },
      { name: 'Limit', type: 'long', value: 10 },
    ];
    const { uuid } = setup({ pivotMissing: { 'parameters.Upn': null } }, 'tim.run_kql', {
      params: { ...kql, parameters },
    });
    expect(screen.getByText('Fill in Upn to run this pivot')).toBeInTheDocument();
    // The needed pill's popover opens by itself.
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('button', { name: /^Query parameters:/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Limit: 10' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Upn: needed' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Upn' }), 'alice@example.com');
    await userEvent.keyboard('{Escape}');

    expect(useTabsStore.getState().tabs[uuid]?.params).toMatchObject({
      params: {
        parameters: [
          { name: 'Upn', type: 'string', value: 'alice@example.com' },
          { name: 'Limit', type: 'long', value: 10 },
        ],
      },
    });
    expect(screen.getByRole('button', { name: 'Upn: alice@example.com' })).toBeInTheDocument();
    expect(screen.queryByText('Fill in Upn to run this pivot')).not.toBeInTheDocument();
  });

  it('marks a query parameter the server refused, until it is edited', async () => {
    setup({ paramErrors: { 'parameters.Limit': 'Must be a whole number' } }, 'tim.run_kql', {
      params: { ...kql, parameters: [{ name: 'Limit', type: 'long', value: 1.5 }] },
    });
    const pill = screen.getByRole('button', { name: 'Limit: 1.5' });
    expect(pill).toHaveAccessibleDescription('Must be a whole number');
    await userEvent.click(pill);
    const field = screen.getByRole('textbox', { name: 'Limit' });
    await userEvent.clear(field);
    await userEvent.type(field, '2');
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Limit: 2' })).not.toHaveAccessibleDescription(
      'Must be a whole number',
    );
  });

  it('takes the query parameters declared in Save… onto the tab', async () => {
    server.use(
      http.post(apiUrl('/api/presets'), async ({ request }) =>
        HttpResponse.json(
          {
            ...((await request.json()) as object),
            presetId: 'p-1',
            owner: 'jo@example.com',
            owned: true,
            hidden: false,
            createdAt: '2026-10-23T00:00:00Z',
            updatedAt: '2026-10-23T00:00:00Z',
          },
          { status: 201 },
        ),
      ),
    );
    const { uuid } = setupKql();
    await userEvent.click(screen.getByRole('button', { name: 'Save…' }));
    const dialog = screen.getByRole('dialog', { name: 'Save preset' });
    const add = within(dialog).getByRole('button', { name: 'Add query parameter' });
    await userEvent.click(add);
    await userEvent.click(add);
    const [since, upn] = within(dialog).getAllByRole('group', { name: /^Query parameter/ });
    await userEvent.type(within(since!).getByRole('combobox', { name: 'Name' }), 'Since');
    await userEvent.selectOptions(within(since!).getByRole('combobox', { name: 'Type' }), 'long');
    await userEvent.type(within(since!).getByRole('textbox', { name: 'Value' }), '7');
    await userEvent.type(within(upn!).getByRole('combobox', { name: 'Name' }), 'Upn');
    await userEvent.click(within(upn!).getByRole('button', { name: 'From row' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('button', { name: 'Since: 7' })).toBeInTheDocument();
    expect(useTabsStore.getState().tabs[uuid]?.params).toMatchObject({
      presetId: 'p-1',
      params: {
        parameters: [
          { name: 'Since', type: 'long', value: 7 },
          { name: 'Upn', type: 'string', value: null },
        ],
      },
    });
  });

  it('has no Query tab for an action without a query param', () => {
    setup();
    expect(screen.queryByRole('tab', { name: 'Query' })).not.toBeInTheDocument();
  });

  describe('declare statement', () => {
    const since = { name: 'since', type: 'datetime', value: null };
    const limit = { name: 'limit', type: 'long', value: 10 };
    let requests: unknown[] = [];
    const answer = (parameters: { name: string; type: string }[]) =>
      `declare query_parameters(${parameters.map((p) => `${p.name}:${p.type}`).join(', ')});`;

    beforeEach(() => {
      requests = [];
      server.use(
        http.post(apiUrl('/api/actions/tim.run_kql/declareStatement'), async ({ request }) => {
          const body = (await request.json()) as { parameters: { name: string; type: string }[] };
          requests.push(body);
          return HttpResponse.json({ declareStatement: answer(body.parameters) });
        }),
      );
    });

    const setParameters = (uuid: string, parameters: object[]) =>
      act(() => useTabsStore.getState().updateParams(uuid, { params: { ...kql, parameters } }));

    it('shows the statement above the query, out of the query text', async () => {
      setup({}, 'tim.run_kql', { params: { ...kql, parameters: [since, limit] } });
      expect(
        await screen.findByText('declare query_parameters(since:datetime, limit:long);'),
      ).toBeInTheDocument();
      expect(requests).toEqual([
        {
          parameters: [
            { name: 'since', type: 'datetime' },
            { name: 'limit', type: 'long' },
          ],
        },
      ]);
      expect(screen.getByRole('textbox', { name: 'Query' })).toHaveValue('StormEvents | take 2');
    });

    it('asks again once the query parameters settle, and hides it without any', async () => {
      const { uuid } = setup({}, 'tim.run_kql', { params: { ...kql, parameters: [since] } });
      await screen.findByText('declare query_parameters(since:datetime);');
      setParameters(uuid, [since, limit]);
      setParameters(uuid, [{ ...since, name: 'from' }, limit]);
      expect(
        await screen.findByText('declare query_parameters(from:datetime, limit:long);'),
      ).toBeInTheDocument();
      expect(requests).toHaveLength(2);
      setParameters(uuid, []);
      expect(screen.queryByText(/^declare/)).not.toBeInTheDocument();
      expect(requests).toHaveLength(2);
    });

    it('forgets the statement once there are none, so the next one shows only when answered', async () => {
      const { uuid } = setup({}, 'tim.run_kql', { params: { ...kql, parameters: [since] } });
      await screen.findByText('declare query_parameters(since:datetime);');
      setParameters(uuid, []);
      setParameters(uuid, [limit]);
      expect(screen.queryByText(/^declare/)).not.toBeInTheDocument();
      expect(await screen.findByText('declare query_parameters(limit:long);')).toBeInTheDocument();
    });

    it('does not ask again when only a value changes', async () => {
      const { uuid } = setup({}, 'tim.run_kql', { params: { ...kql, parameters: [limit] } });
      await screen.findByText('declare query_parameters(limit:long);');
      setParameters(uuid, [{ ...limit, value: 11 }]);
      await new Promise((r) => setTimeout(r, 500));
      expect(requests).toHaveLength(1);
    });

    it.each([
      ['there is nothing to declare', () => new HttpResponse(null, { status: 204 })],
      ['the request fails', () => problemResponse(500)],
    ])('shows no statement when %s', async (_, respond) => {
      let answered = false;
      server.use(
        http.post(apiUrl('/api/actions/tim.run_kql/declareStatement'), () => {
          answered = true;
          return respond();
        }),
      );
      setup({}, 'tim.run_kql', { params: { ...kql, parameters: [since] } });
      await vi.waitFor(() => expect(answered).toBe(true));
      await new Promise((r) => setTimeout(r, 50));
      expect(screen.queryByText(/^declare/)).not.toBeInTheDocument();
    });
  });
});
