import 'fake-indexeddb/auto';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import type { GridApi, MenuItemDef } from 'ag-grid-community';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../../lib/api';
import { resetTimDb, rowResultsDao } from '../../lib/storage';
import { NotifyContext } from '../../components/notifyContext';
import { apiUrl, problemResponse, TEST_API } from '../../test/msw/handlers';
import { setupMswServer } from '../../test/msw/server';
import { getDetermination, ResultsGrid } from '../grid';
import type { GridRowWithId } from '../grid';
import { TagDialogProvider } from './TagDialogProvider';
import { buildTaggingMenu } from './useTaggingMenu';
import type { TagMenuParams } from './useTaggingMenu';
import { TagDialogContext } from './TagDialogContext';
import { useContext } from 'react';

const server = setupMswServer();
const client = createApiClient({
  baseUrl: TEST_API,
  getToken: () => Promise.resolve('t'),
  timeoutMs: 0,
});
const call = { client };

const rows = [
  { EventId: 'a', EventTime: '2024-01-01T00:00:00Z', Name: 'alpha' },
  {
    EventId: 'b',
    EventTime: '2024-01-02T00:00:00Z',
    Name: 'beta',
    TagEvent: { IsSaved: true, Tags: ['old'] },
  },
];

let calls: { path: string; body: unknown }[] = [];
const record = (path: string) =>
  http.post(apiUrl(path), async ({ request }) => {
    calls.push({ path, body: await request.json() });
    return new HttpResponse(null, { status: 204 });
  });

const notify = vi.fn();
let api!: GridApi<GridRowWithId>;

/** Grid + provider + a button that opens the dialog via the real menu item. */
function Harness() {
  const open = useContext(TagDialogContext);
  const menu = buildTaggingMenu('tab', { notify: vi.fn(), call, openDialog: open });
  return (
    <button
      onClick={() => {
        const params = { node: api.getRowNode('a'), api } as unknown as TagMenuParams;
        api.getRowNode('a')?.setSelected(true);
        api.getRowNode('b')?.setSelected(true);
        const items = menu(params as never);
        const sub = ((items[0] as MenuItemDef).subMenu ?? []) as MenuItemDef[];
        (sub[0]?.action as () => void)();
      }}
    >
      open-dialog
    </button>
  );
}

async function setup() {
  await rowResultsDao.put('tab', rows);
  render(
    <NotifyContext.Provider value={notify}>
      <TagDialogProvider call={call}>
        <ResultsGrid
          rows={rows}
          height={400}
          detailPanel={false}
          columnViews={false}
          onGridReady={(e) => (api = e.api)}
        />
        <Harness />
      </TagDialogProvider>
    </NotifyContext.Provider>,
  );
  await waitFor(() => expect(api?.getDisplayedRowCount()).toBe(2));
  // delay: null skips the per-keystroke setTimeout(0) that stalls under CPU contention.
  const user = userEvent.setup({ delay: null });
  await user.click(screen.getByText('open-dialog'));
  const dialog = await screen.findByRole('dialog');
  return { user, dialog };
}

type User = ReturnType<typeof userEvent.setup>;

/** Focus the field and paste the text in one input event (no per-key typing). */
async function fill(user: User, field: HTMLElement, text: string) {
  await user.click(field);
  await user.paste(text);
}

async function choose(user: User, label: RegExp, option: string) {
  await user.click(screen.getByRole('combobox', { name: label }));
  await user.click(await screen.findByRole('option', { name: option }));
}

beforeEach(async () => {
  calls = [];
  notify.mockClear();
  await resetTimDb();
});

describe('TagDialog', () => {
  it('shows the selection count and validation messages without sending anything', async () => {
    server.use(record('/api/taggedevents/comments'));
    const { user, dialog } = await setup();
    expect(within(dialog).getByText('2 event(s) selected')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Determination cannot be empty.')).toBeTruthy();
    expect(within(dialog).getByText('Comment cannot be empty.')).toBeTruthy();
    expect(calls).toEqual([]);
  });

  it('disables the Tags field only while the tag action is Ignore', async () => {
    const { user, dialog } = await setup();
    const tags = () => within(dialog).getByRole('combobox', { name: 'Tags' });
    expect(tags()).toBeDisabled();
    await choose(user, /tag action/i, 'Append');
    expect(tags()).toBeEnabled();
    await choose(user, /tag action/i, 'Ignore');
    expect(tags()).toBeDisabled();
  });

  it('previews tag modifications', async () => {
    const { user, dialog } = await setup();
    await choose(user, /tag action/i, 'Append');
    await fill(user, within(dialog).getByRole('combobox', { name: 'Tags' }), 'new');
    await user.keyboard('{Enter}');
    expect(await within(dialog).findByText('Adding new to 2 event(s).')).toBeTruthy();
  });

  it('submits, updates the grid rows and closes', async () => {
    server.use(
      record('/api/taggedevents/savedEvents'),
      record('/api/taggedevents/comments'),
      record('/api/taggedevents/tags'),
    );
    const { user, dialog } = await setup();
    await choose(user, /^determination$/i, 'Malicious');
    await fill(user, within(dialog).getByRole('textbox', { name: 'Comment' }), 'looks bad');
    await choose(user, /tag action/i, 'Append');
    await fill(user, within(dialog).getByRole('combobox', { name: 'Tags' }), 'apt');
    await user.keyboard('{Enter}');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls.map((c) => c.path)).toEqual([
      '/api/taggedevents/savedEvents',
      '/api/taggedevents/comments',
      '/api/taggedevents/tags',
    ]);
    expect(getDetermination(api.getRowNode('a')?.data as GridRowWithId)).toBe('malicious');
    expect(api.getRowNode('b')?.data?.['TagEvent']).toMatchObject({
      Comment: 'looks bad',
      Tags: ['old', 'apt'],
      IsSaved: true,
    });
    const stored = await rowResultsDao.get('tab');
    expect(stored[0]?.['TagEvent']).toMatchObject({ Determination: 'malicious' });
    expect(stored[0]).not.toHaveProperty('_id');
    expect(notify).toHaveBeenLastCalledWith('Tag events successfully customised.');
  });

  it('keeps the dialog open and shows the error when a request fails', async () => {
    server.use(
      record('/api/taggedevents/savedEvents'),
      http.post(apiUrl('/api/taggedevents/comments'), () =>
        problemResponse(502, { detail: 'ingestion down' }),
      ),
    );
    const { user, dialog } = await setup();
    await choose(user, /^determination$/i, 'Benign');
    await fill(user, within(dialog).getByRole('textbox', { name: 'Comment' }), 'fine');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(
      await within(dialog).findByText('Customisation of tag events failed: ingestion down'),
    ).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Save' })).toHaveProperty('disabled', false);
    expect(getDetermination(api.getRowNode('a')?.data as GridRowWithId)).not.toBe('benign');
    expect(notify).toHaveBeenLastCalledWith('Customisation of tag events failed: ingestion down');
  });

  it('Close dismisses without sending', async () => {
    const { user, dialog } = await setup();
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls).toEqual([]);
  });
});
