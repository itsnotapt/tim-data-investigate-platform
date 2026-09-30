import 'fake-indexeddb/auto';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ColDef, EditableCallbackParams } from 'ag-grid-community';
import { createApiClient } from '../../lib/api';
import { resetTimDb, rowResultsDao } from '../../lib/storage';
import { apiUrl, problemResponse, TEST_API } from '../../test/msw/handlers';
import { setupMswServer } from '../../test/msw/server';
import { buildColumnDefs, prepareRows } from '../grid';
import type { GridRowWithId } from '../grid';
import { commentEdit, COMMENT_MESSAGES } from './commentEdit';
import type { CommentEditEvent } from './commentEdit';

const server = setupMswServer();
const client = createApiClient({
  baseUrl: TEST_API,
  getToken: () => Promise.resolve('t'),
  timeoutMs: 0,
});

const raw = [
  { EventId: 'a', Name: 'unsaved', TagEvent: { IsSaved: false, Determination: 'benign' } },
  {
    EventId: 'b',
    Name: 'saved',
    TagEvent: { IsSaved: true, Determination: 'malicious', Comment: 'old' },
  },
  { EventId: 'c', Name: 'saved, no determination', TagEvent: { IsSaved: true } },
];
const rows = prepareRows(raw);

let calls: unknown[] = [];
const okHandler = http.post(apiUrl('/api/taggedevents/comments'), async ({ request }) => {
  calls.push(await request.json());
  return new HttpResponse(null, { status: 204 });
});

function event(data: GridRowWithId | undefined, over: Partial<CommentEditEvent> = {}) {
  const applyTransaction = vi.fn();
  const refresh = vi.fn();
  const ev: CommentEditEvent = {
    column: { getColId: () => 'TagEvent.Comment' },
    data,
    oldValue: 'old',
    newValue: 'new text',
    api: { applyTransaction, refreshCells: refresh },
    ...over,
  };
  return { ev, applyTransaction, refresh };
}

beforeEach(async () => {
  calls = [];
  await resetTimDb();
  await rowResultsDao.put('tab', raw);
});

describe('comment column definitions', () => {
  const defs = buildColumnDefs(raw, { Name: { editable: true } });
  const editable = (field: string, data: unknown) => {
    const def = defs.find((d) => d.field === field) as ColDef;
    const e = def.editable;
    return typeof e === 'function' ? e({ data } as EditableCallbackParams) : e;
  };

  it('only TagEvent.Comment can be edited, and only for saved rows with a determination', () => {
    expect(editable('Name', rows[1])).toBe(false); // template override ignored, BUG-42
    expect(editable('EventId', rows[1])).toBe(false);
    expect(editable('TagEvent.Comment', rows[0])).toBe(false);
    expect(editable('TagEvent.Comment', rows[2])).toBe(false);
    expect(editable('TagEvent.Comment', rows[1])).toBe(true);
  });
});

describe('commentEdit', () => {
  it('persists the comment and updates the row and stored rows', async () => {
    server.use(okHandler);
    const notify = vi.fn();
    const { ev, applyTransaction } = event(rows[1]);
    await expect(commentEdit(ev, { uuid: 'tab', notify, call: { client } })).resolves.toBe(true);
    expect(calls).toEqual([
      [{ eventId: 'b', determination: 'malicious', comment: 'new text', isDeleted: false }],
    ]);
    expect(notify.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      'Quick saving comment...',
      'Comment successfully quick saved.',
    ]);
    expect(COMMENT_MESSAGES.success).toBe('Comment successfully quick saved.');
    const update = (applyTransaction.mock.calls[0]?.[0] as { update: GridRowWithId[] }).update[0];
    expect(update?._id).toBe('b');
    expect(update?.['TagEvent']).toEqual({
      IsSaved: true,
      Determination: 'malicious',
      Comment: 'new text',
    });
    const stored = await rowResultsDao.get('tab');
    expect((stored[1]?.['TagEvent'] as { Comment: string }).Comment).toBe('new text');
    expect(stored[1]).not.toHaveProperty('_id');
    expect((stored[0]?.['TagEvent'] as { Comment?: string }).Comment).toBeUndefined();
  });

  it('ignores non-saved rows, rows without determination, other columns and unchanged values', async () => {
    server.use(okHandler);
    const notify = vi.fn();
    for (const ev of [
      event(rows[0]).ev,
      event(rows[2]).ev,
      event(rows[1], { column: { getColId: () => 'Name' } }).ev,
      event(rows[1], { newValue: 'old' }).ev,
      event(undefined).ev,
    ]) {
      await expect(commentEdit(ev, { uuid: 'tab', notify, call: { client } })).resolves.toBe(false);
    }
    expect(calls).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
  });

  it('on failure leaves the row unchanged and shows an error snackbar', async () => {
    server.use(
      http.post(apiUrl('/api/taggedevents/comments'), () =>
        problemResponse(400, { title: 'validation', detail: 'comment too long' }),
      ),
    );
    const notify = vi.fn();
    const { ev, applyTransaction, refresh } = event(rows[1]);
    await expect(commentEdit(ev, { uuid: 'tab', notify, call: { client } })).resolves.toBe(false);
    expect(applyTransaction).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
    expect(notify).toHaveBeenLastCalledWith('Saving comments failed: comment too long');
    const stored = await rowResultsDao.get('tab');
    expect((stored[1]?.['TagEvent'] as { Comment: string }).Comment).toBe('old');
  });
});
