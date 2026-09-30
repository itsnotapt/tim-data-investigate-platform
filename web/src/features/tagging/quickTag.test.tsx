import 'fake-indexeddb/auto';
import { waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { render } from '@testing-library/react';
import type { GridApi, MenuItemDef } from 'ag-grid-community';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../../lib/api';
import { resetTimDb, rowResultsDao } from '../../lib/storage';
import { apiUrl, problemResponse, TEST_API } from '../../test/msw/handlers';
import { setupMswServer } from '../../test/msw/server';
import { getDetermination, prepareRows, ResultsGrid } from '../grid';
import type { ExtraMenuItems, GridRowWithId } from '../grid';
import { buildTaggingMenu } from './useTaggingMenu';
import type { TagMenuParams } from './useTaggingMenu';
import { quickTag } from './quickTag';

const server = setupMswServer();
const client = createApiClient({
  baseUrl: TEST_API,
  getToken: () => Promise.resolve('t'),
  timeoutMs: 0,
});

const rows = [
  { EventId: 'a', EventTime: '2024-01-01T00:00:00Z', Name: 'alpha' },
  { EventId: 'b', EventTime: '2024-01-02T00:00:00Z', TagEvent: { IsSaved: true, Comment: 'keep' } },
  { EventId: 'c', Name: 'no time' },
];

const quickItems = (items: ExtraMenuItems): MenuItemDef[] =>
  (((items[0] as MenuItemDef).subMenu ?? []) as MenuItemDef[]).filter((i) =>
    i.name?.startsWith('Quick'),
  );
const run = (item: MenuItemDef | undefined) => (item?.action as (() => void) | undefined)?.();

let calls: { path: string; body: unknown }[] = [];
function record(path: string, status = 204) {
  return http.post(apiUrl(path), async ({ request }) => {
    calls.push({ path, body: await request.json() });
    return new HttpResponse(null, { status });
  });
}

beforeEach(async () => {
  calls = [];
  await resetTimDb();
});

describe('quickTag', () => {
  it('saves unsaved events, then comments (lower-case), and reports the legacy texts', async () => {
    server.use(record('/api/taggedevents/savedEvents'), record('/api/taggedevents/comments'));
    const notify = vi.fn();
    const r = await quickTag(prepareRows(rows.slice(0, 2)), 'Malicious', notify, { client });
    expect(calls.map((c) => c.path)).toEqual([
      '/api/taggedevents/savedEvents',
      '/api/taggedevents/comments',
    ]);
    expect(calls[0]?.body).toEqual([
      expect.objectContaining({ eventId: 'a', eventTime: '2024-01-01T00:00:00Z' }),
    ]);
    expect(calls[1]?.body).toEqual([
      { eventId: 'a', determination: 'malicious', isDeleted: false },
      { eventId: 'b', determination: 'malicious', isDeleted: false },
    ]);
    expect(notify.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      'Quick saving events...',
      'Tag events successfully saved.',
    ]);
    expect(r.ok && r.rows.map((x) => getDetermination(x))).toEqual(['malicious', 'malicious']);
  });

  it('skips the saved-events call when every row is saved', async () => {
    server.use(record('/api/taggedevents/comments'));
    const r = await quickTag(
      prepareRows([rows[1] as object as Record<string, unknown>]),
      'Benign',
      vi.fn(),
      { client },
    );
    expect(calls.map((c) => c.path)).toEqual(['/api/taggedevents/comments']);
    expect(r.ok).toBe(true);
  });

  it('a failed save stops before comments: "Saving events failed: ..."', async () => {
    server.use(
      http.post(apiUrl('/api/taggedevents/savedEvents'), () =>
        problemResponse(400, { title: 'validation', detail: 'eventId is blank' }),
      ),
      record('/api/taggedevents/comments'),
    );
    const notify = vi.fn();
    const r = await quickTag(prepareRows(rows.slice(0, 1)), 'Benign', notify, { client });
    expect(r.ok).toBe(false);
    expect(calls).toEqual([]);
    expect(notify).toHaveBeenLastCalledWith('Saving events failed: eventId is blank');
  });

  it('a failed comment request: "Saving comments failed: ..."', async () => {
    server.use(
      record('/api/taggedevents/savedEvents'),
      http.post(apiUrl('/api/taggedevents/comments'), () =>
        problemResponse(502, { detail: 'ingestion down' }),
      ),
    );
    const notify = vi.fn();
    const r = await quickTag(prepareRows(rows.slice(0, 1)), 'Benign', notify, { client });
    expect(r.ok).toBe(false);
    expect(notify).toHaveBeenLastCalledWith('Saving comments failed: ingestion down');
  });
});

describe('tagging context menu', () => {
  async function setup() {
    let api!: GridApi<GridRowWithId>;
    await rowResultsDao.put('tab', rows);
    render(
      <ResultsGrid
        rows={rows}
        height={400}
        detailPanel={false}
        columnViews={false}
        onGridReady={(e) => (api = e.api)}
      />,
    );
    await waitFor(() => expect(api?.getDisplayedRowCount()).toBe(3));
    return api;
  }
  const paramsFor = (api: GridApi<GridRowWithId>, id: string) =>
    ({ node: api.getRowNode(id), api }) as unknown as TagMenuParams;

  it('is disabled when a target row lacks EventTime, enabled otherwise', async () => {
    const api = await setup();
    const menu = buildTaggingMenu('tab', { notify: vi.fn(), call: { client } });
    const build = (id: string) => menu(paramsFor(api, id) as never);
    expect(build('a')[0]).toMatchObject({ name: 'Tag Events', disabled: false });
    // "Customise tag events" comes first and needs the dialog context.
    expect(((build('a')[0] as MenuItemDef).subMenu as MenuItemDef[])[0]).toMatchObject({
      name: 'Customise tag events',
      disabled: true,
    });
    expect(build('c')[0]).toMatchObject({ disabled: true });
    api.getRowNode('a')?.setSelected(true);
    api.getRowNode('c')?.setSelected(true);
    expect(build('a')[0]).toMatchObject({ disabled: true });
  });

  it('quick tag recolours rows, persists them and clears the selection', async () => {
    server.use(record('/api/taggedevents/savedEvents'), record('/api/taggedevents/comments'));
    const api = await setup();
    const notify = vi.fn();
    const menu = buildTaggingMenu('tab', { notify, call: { client } });
    api.getRowNode('a')?.setSelected(true);
    api.getRowNode('b')?.setSelected(true);
    const item = quickItems(menu(paramsFor(api, 'a') as never));
    expect(item.map((i) => i.name)).toEqual([
      'Quick - Malicious',
      'Quick - Suspicious',
      'Quick - Benign',
    ]);
    run(item[1]);
    await waitFor(() => expect(api.getSelectedNodes()).toHaveLength(0));
    expect(getDetermination(api.getRowNode('a')?.data)).toBe('suspicious');
    expect(getDetermination(api.getRowNode('b')?.data)).toBe('suspicious');
    expect(getDetermination(api.getRowNode('c')?.data)).toBeNull();
    expect(calls.map((c) => c.path)).toEqual([
      '/api/taggedevents/savedEvents',
      '/api/taggedevents/comments',
    ]);
    const stored = await rowResultsDao.get('tab');
    expect(stored[0]).toMatchObject({
      EventId: 'a',
      TagEvent: { Determination: 'suspicious', IsSaved: true },
    });
    expect(stored[0]).not.toHaveProperty('_id');
    expect(stored[1]).toMatchObject({ TagEvent: { Comment: 'keep', Determination: 'suspicious' } });
    expect(stored[2]).toEqual(rows[2]);
  });

  it('failure leaves rows and storage untouched', async () => {
    server.use(
      http.post(apiUrl('/api/taggedevents/savedEvents'), () =>
        problemResponse(502, { detail: 'down' }),
      ),
    );
    const api = await setup();
    const notify = vi.fn();
    const menu = buildTaggingMenu('tab', { notify, call: { client } });
    const sub = quickItems(menu(paramsFor(api, 'a') as never));
    run(sub[0]);
    await waitFor(() => expect(notify).toHaveBeenLastCalledWith('Saving events failed: down'));
    expect(getDetermination(api.getRowNode('a')?.data)).toBeNull();
    expect((await rowResultsDao.get('tab'))[0]).toEqual(rows[0]);
  });
});
