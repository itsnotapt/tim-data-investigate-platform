import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Run, RunRow } from '../../lib/api';
import { apiUrl, problemResponse } from '../../test/msw/handlers';
import { setupMswServer } from '../../test/msw/server';
import { configureTestApp, resetTestApp } from '../../test/testApp';
import { useTabsStore } from '../tabs/tabStore';
import ShareLinkPage from './ShareLinkPage';

const server = setupMswServer();
const RUN_ID = '5b0c5d0e-1f7e-4a8e-9d55-2f1c2f3a4b5c';

const run: Run = {
  runId: RUN_ID,
  status: 'succeeded',
  action: { key: 'dev-sign-ins', name: 'Sign-ins' },
  params: { users: ['alice'] },
  owner: 'jo@example.com',
  startedAt: '2026-10-20T10:00:00Z',
  finishedAt: '2026-10-20T10:00:02Z',
  expiresAt: '2026-10-21T10:00:00Z',
  details: {},
  columns: [{ name: 'User', type: 'string', declared: true }],
  rowCount: 2,
};
const rows: RunRow[] = [
  { row: 0, data: { User: 'alice' } },
  { row: 1, data: { User: 'bob' } },
];
const rowsPage = () => HttpResponse.json({ rows, lastRow: rows.length, annotationVersion: 1 });

/** Runs started; a link never starts one. */
let started = 0;

function Loc() {
  return <div data-testid="loc">{useLocation().pathname}</div>;
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="runs/:runId" element={<ShareLinkPage />} />
        <Route path="view/:uuid" element={<Loc />} />
      </Routes>
    </MemoryRouter>,
  );
}

const onlyTab = () => {
  const tabs = Object.values(useTabsStore.getState().tabs);
  expect(tabs).toHaveLength(1);
  return tabs[0]!;
};

beforeEach(() => {
  configureTestApp();
  started = 0;
  server.use(
    http.post(apiUrl('/api/runs'), () => {
      started++;
      return HttpResponse.json(run);
    }),
  );
  useTabsStore.reset();
  useTabsStore.setState({ loaded: true });
});
afterEach(resetTestApp);

describe('ShareLinkPage', () => {
  it("opens an ordinary tab holding the run, with the run's params and the linked row", async () => {
    server.use(
      http.get(apiUrl(`/api/runs/${RUN_ID}`), () => HttpResponse.json(run)),
      http.get(apiUrl(`/api/runs/${RUN_ID}/rows`), rowsPage),
    );
    renderAt(`/runs/${RUN_ID}?row=1`);

    const loc = await screen.findByTestId('loc');
    const tab = onlyTab();
    expect(loc).toHaveTextContent(`/view/${tab.componentUuid}`);
    expect(tab).toMatchObject({
      componentName: 'ActionResult',
      parentUuid: null,
      title: 'Sign-ins',
      params: { action: 'dev-sign-ins', params: { users: ['alice'] } },
    });
    expect(tab.state).toMatchObject({ linkedRow: 1, runParams: { users: ['alice'] } });
    await waitFor(() => expect(onlyTab().state.resultsRunId).toBe(RUN_ID));
    expect(onlyTab().state.rowCount).toBe(2);
    expect(started).toBe(0);
  });

  it('names no row without ?row', async () => {
    server.use(
      http.get(apiUrl(`/api/runs/${RUN_ID}`), () => HttpResponse.json(run)),
      http.get(apiUrl(`/api/runs/${RUN_ID}/rows`), rowsPage),
    );
    renderAt(`/runs/${RUN_ID}`);

    await screen.findByTestId('loc');
    expect(onlyTab().state.linkedRow ?? null).toBeNull();
  });

  it('fills in a run still going when it ends', async () => {
    let polls = 0;
    server.use(
      http.get(apiUrl(`/api/runs/${RUN_ID}`), () =>
        HttpResponse.json(
          polls++ === 0
            ? { ...run, status: 'running', finishedAt: undefined, rowCount: undefined }
            : run,
        ),
      ),
      http.get(apiUrl(`/api/runs/${RUN_ID}/rows`), rowsPage),
    );
    renderAt(`/runs/${RUN_ID}`);

    await screen.findByTestId('loc');
    expect(onlyTab().state).toMatchObject({
      isExecuting: true,
      run: { runId: RUN_ID, status: 'running' },
    });
    await waitFor(() => expect(onlyTab().state.resultsRunId).toBe(RUN_ID), { timeout: 3000 });
    expect(onlyTab().state).toMatchObject({ isExecuting: false, rowCount: 2 });
    expect(started).toBe(0);
  });

  it.each([
    ['unknown or expired', 404, 'getRun'],
    ['whose rows are gone', 410, 'getRunRows'],
  ])('shows only that the result is no longer available for a run %s', async (_, status, call) => {
    server.use(
      http.get(apiUrl(`/api/runs/${RUN_ID}`), () =>
        call === 'getRun'
          ? problemResponse(404, { type: 'urn:tim:problem:not-found' })
          : HttpResponse.json(run),
      ),
      http.get(apiUrl(`/api/runs/${RUN_ID}/rows`), () =>
        problemResponse(status, { type: 'urn:tim:problem:results-gone' }),
      ),
    );
    renderAt(`/runs/${RUN_ID}?row=1`);

    expect(await screen.findByText('This result is no longer available')).toBeInTheDocument();
    expect(screen.queryByTestId('loc')).not.toBeInTheDocument();
    expect(useTabsStore.getState().tabs).toEqual({});
  });

  it('says why a run it could not read was not opened', async () => {
    server.use(
      http.get(apiUrl(`/api/runs/${RUN_ID}`), () =>
        problemResponse(500, { type: 'urn:tim:problem:internal', title: 'Internal error' }),
      ),
    );
    renderAt(`/runs/${RUN_ID}`);

    expect(await screen.findByText(/^Couldn't open the result: /)).toBeInTheDocument();
    expect(screen.queryByText('This result is no longer available')).not.toBeInTheDocument();
    expect(useTabsStore.getState().tabs).toEqual({});
  });
});
