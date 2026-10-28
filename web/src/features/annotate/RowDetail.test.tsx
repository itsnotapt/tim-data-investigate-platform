import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createApiClient,
  type Annotations,
  type HistoryEntry,
  type InstanceLabel,
} from '../../lib/api';
import { apiUrl, problemResponse, TEST_API } from '../../test/msw/handlers';
import { setupMswServer } from '../../test/msw/server';
import { SnackbarHost } from '../../components/SnackbarHost';
import type { LabelledRow } from '../labels';
import { RowDetail, type RowDetailProps } from './RowDetail';

const server = setupMswServer();
const call = {
  client: createApiClient({
    baseUrl: TEST_API,
    getToken: () => Promise.resolve('t'),
    timeoutMs: 0,
  }),
};

const labels: InstanceLabel[] = [
  { key: 'malicious', name: 'Malicious', colour: 'red', symbol: 'skull' },
  { key: 'benign', name: 'Benign', colour: 'green', symbol: 'check' },
];

const row = (id: string | null, data: Record<string, unknown> = {}, n = 3): LabelledRow => ({
  row: n,
  id,
  data,
});

const annotations: Annotations = {
  id: 'h1',
  label: { key: 'malicious', by: 'bob@example.com', at: '2026-10-21T10:05:00Z' },
  tags: ['beacon', 'c2'],
  comments: [],
  version: 4,
};

const entries: HistoryEntry[] = [
  { kind: 'label', label: 'malicious', by: 'bob@example.com', at: '2026-10-21T10:05:00Z' },
  {
    kind: 'comment',
    author: 'bob@example.com',
    at: '2026-10-21T10:04:00Z',
    text: 'beacons every 60s',
  },
  { kind: 'label', label: 'benign', by: 'alice@example.com', at: '2026-10-21T10:00:00Z' },
  { kind: 'comment', author: 'alice@example.com', at: '2026-10-21T09:00:00Z', text: 'first look' },
];

let asked: string[] = [];
let patches: unknown[] = [];

beforeEach(() => {
  asked = [];
  patches = [];
  server.use(
    http.get(apiUrl('/api/annotations/history'), ({ request }) => {
      asked.push(new URL(request.url).searchParams.get('id') ?? '');
      return HttpResponse.json({ entries });
    }),
    http.patch(apiUrl('/api/annotations'), async ({ request }) => {
      patches.push(await request.json());
      return HttpResponse.json({ changes: [{ ...annotations, version: 5 }], version: 5 });
    }),
  );
});

const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';

const commented: Annotations = {
  ...annotations,
  comments: [
    { author: BOB, at: '2026-10-21T10:04:00Z', text: 'beacons every 60s' },
    { author: ALICE, at: '2026-10-21T10:06:00Z', text: 'first look' },
  ],
};

const fixed = { labels, columns: [], idParam: true, analyst: ALICE, call };

function renderPanel(props: Partial<RowDetailProps> = {}) {
  const onCommented = vi.fn();
  const onClose = vi.fn();
  const user = userEvent.setup(); // a clipboard to read back
  const view = render(
    <RowDetail
      {...fixed}
      row={row('h1', { Host: 'h1', Bytes: 2048, Empty: '' })}
      annotations={annotations}
      onCommented={onCommented}
      onClose={onClose}
      {...props}
    />,
    { wrapper: SnackbarHost },
  );
  const rerender = (next: Partial<RowDetailProps>) =>
    view.rerender(
      <RowDetail
        {...fixed}
        row={row('h1')}
        annotations={annotations}
        onCommented={onCommented}
        onClose={onClose}
        {...next}
      />,
    );
  return { ...view, rerender, onCommented, onClose, user };
}

const panel = () => screen.getByRole('complementary', { name: 'Row detail' });
const fields = () => within(screen.getByRole('region', { name: 'Fields' }));
const historyItems = () =>
  within(screen.getByRole('list', { name: 'History' }))
    .getAllByRole('listitem')
    .map((item) => item.textContent);

describe('RowDetail', () => {
  it("shows the row's number, the id, its label with who and when, its tags and the fields", async () => {
    const { onClose, user } = renderPanel();
    const p = within(panel());
    expect(p.getByText('row 3 · D closes · ↑↓ move rows')).toBeInTheDocument();
    expect(p.getByText('h1', { selector: 'code' })).toBeInTheDocument();
    expect(p.getByText('Malicious')).toBeInTheDocument();
    expect(p.getByText('bob@example.com · 2026-10-21 10:05 UTC')).toBeInTheDocument();
    expect(p.getByText('beacon')).toBeInTheDocument();
    expect(p.getByText('c2')).toBeInTheDocument();
    expect(fields().getByText('Bytes')).toBeInTheDocument();
    expect(fields().getByText('2048')).toBeInTheDocument();
    expect(fields().queryByText('Empty')).not.toBeInTheDocument();
    await screen.findByRole('list', { name: 'History' });
    await user.click(p.getByRole('button', { name: 'Close row detail' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the history newest first, label changes as old → new and comments as a thread', async () => {
    renderPanel();
    await screen.findByRole('list', { name: 'History' });
    expect(historyItems()).toEqual([
      'Benign → Malicious · bob@example.com · 2026-10-21 10:05 UTC',
      'bob@example.com · 2026-10-21 10:04 UTCbeacons every 60s',
      'No label → Benign · alice@example.com · 2026-10-21 10:00 UTC',
      'alice@example.com · 2026-10-21 09:00 UTCfirst look',
    ]);
    expect(asked).toEqual(['h1']);
  });

  it("starts with your comment, and lists the others' comments below it", async () => {
    renderPanel({ annotations: commented });
    await screen.findByRole('list', { name: 'History' });
    expect(screen.getByRole('textbox', { name: 'Comment' })).toHaveValue('first look');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(
      within(screen.getByRole('list', { name: 'Other comments' }))
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([`${BOB} · 2026-10-21 10:04 UTCbeacons every 60s`]);
  });

  it('replaces your comment with Save, then reads the history again', async () => {
    const { onCommented, user } = renderPanel({ annotations: commented });
    await screen.findByRole('list', { name: 'History' });
    const box = screen.getByRole('textbox', { name: 'Comment' });
    await user.clear(box);
    await user.type(box, '  same C2{Enter}as h2 ');
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(patches).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onCommented).toHaveBeenCalledWith([{ ...annotations, version: 5 }]));
    expect(patches).toEqual([{ ids: ['h1'], comment: 'same C2\nas h2' }]);
    await waitFor(() => expect(asked).toEqual(['h1', 'h1']));
  });

  it('clears your comment when saved empty', async () => {
    const { onCommented, user } = renderPanel({ annotations: commented });
    await user.clear(screen.getByRole('textbox', { name: 'Comment' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onCommented).toHaveBeenCalled());
    expect(patches).toEqual([{ ids: ['h1'], comment: null }]);
  });

  it('shows an earlier version of a comment as edited, and an empty one as cleared', async () => {
    server.use(
      http.get(apiUrl('/api/annotations/history'), () =>
        HttpResponse.json({
          entries: [
            { kind: 'comment', author: BOB, at: '2026-10-21T10:09:00Z', text: '' },
            { kind: 'comment', author: ALICE, at: '2026-10-21T10:08:00Z', text: 'same C2' },
            { kind: 'comment', author: BOB, at: '2026-10-21T10:07:00Z', text: 'beacons' },
            { kind: 'comment', author: ALICE, at: '2026-10-21T10:06:00Z', text: 'first look' },
          ],
        }),
      ),
    );
    renderPanel();
    await screen.findByRole('list', { name: 'History' });
    expect(historyItems()).toEqual([
      `${BOB} · 2026-10-21 10:09 UTC · cleared their comment`,
      `${ALICE} · 2026-10-21 10:08 UTCsame C2`,
      `${BOB} · 2026-10-21 10:07 UTC · editedbeacons`,
      `${ALICE} · 2026-10-21 10:06 UTC · editedfirst look`,
    ]);
  });

  it('keeps the comment and shows why when saving it fails', async () => {
    server.use(
      http.patch(apiUrl('/api/annotations'), () =>
        problemResponse(422, { errors: { comment: ["A comment can't be blank"] } }),
      ),
    );
    const { onCommented, user } = renderPanel();
    await user.type(screen.getByRole('textbox', { name: 'Comment' }), 'x');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/Couldn't save the comment/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Comment' })).toHaveValue('x');
    expect(onCommented).not.toHaveBeenCalled();
  });

  it('reads the history again when the id or its annotations change', async () => {
    const { rerender } = renderPanel();
    await waitFor(() => expect(asked).toEqual(['h1']));
    rerender({ annotations: { ...annotations, version: 6 } });
    await waitFor(() => expect(asked).toEqual(['h1', 'h1']));
    rerender({ row: row('h2'), annotations: null });
    await waitFor(() => expect(asked).toEqual(['h1', 'h1', 'h2']));
    expect(screen.getByText('No label')).toBeInTheDocument();
  });

  it("shows no earlier id's history while another id's loads", async () => {
    let answer: (() => void) | null = null;
    const { rerender } = renderPanel();
    await screen.findByRole('list', { name: 'History' });
    server.use(
      http.get(
        apiUrl('/api/annotations/history'),
        () =>
          new Promise<Response>((resolve) => {
            answer = () => resolve(HttpResponse.json({ entries: [] }));
          }),
      ),
    );
    rerender({ row: row('h2'), annotations: null });
    expect(screen.queryByRole('list', { name: 'History' })).not.toBeInTheDocument();
    await waitFor(() => expect(answer).not.toBeNull());
    answer!();
    expect(await screen.findByText('No history yet.')).toBeInTheDocument();
  });

  it('keeps a half-typed comment with its id, and gives it back on returning to the id', async () => {
    const { rerender, user } = renderPanel();
    const box = () => screen.getByRole('textbox', { name: 'Comment' });
    await user.type(box(), 'about h1');
    rerender({ row: row('h2', {}, 4), annotations: null });
    expect(box()).toHaveValue('');
    await user.type(box(), 'about h2');
    rerender({ row: row(null, {}, 5), annotations: null });
    rerender({ row: row('h1', {}, 6) });
    expect(box()).toHaveValue('about h1');
    rerender({ row: row('h2', {}, 4), annotations: null });
    expect(box()).toHaveValue('about h2');
  });

  it('copies a value as shown, an object as JSON, and the id, each saying so in a toast', async () => {
    const evidence = { path: 'C:\\Windows\\svchost.exe', ports: [443] };
    const { user } = renderPanel({ row: row('h1', { Host: 'h1', Evidence: evidence }) });
    await user.click(screen.getByRole('button', { name: 'Copy Host' }));
    expect(await navigator.clipboard.readText()).toBe('h1');
    expect(await screen.findByText('Copied Host')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copy Evidence' }));
    const copied = await navigator.clipboard.readText();
    expect(copied).toBe(JSON.stringify(evidence, null, 2));
    expect(JSON.parse(copied)).toEqual(evidence);
    await user.click(screen.getByRole('button', { name: 'Copy id' }));
    expect(await navigator.clipboard.readText()).toBe('h1');
  });

  it('clamps a value over 180 characters or 3 lines, copies all of it, and clamps again on another row', async () => {
    const long = `cmd.exe /c ${'x'.repeat(1290)}`;
    const { rerender, user } = renderPanel({
      row: row('h1', { Short: 'a\nb\nc', Lines: 'a\nb\nc\nd', CommandLine: long }),
    });
    expect(fields().getByRole('button', { name: 'Show all (7 characters)' })).toBeInTheDocument();
    await user.click(fields().getByRole('button', { name: 'Show all (1,301 characters)' }));
    expect(fields().getByRole('button', { name: 'Show less' })).toBeInTheDocument();
    expect(fields().getAllByRole('button', { name: /^Show all/ })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Copy CommandLine' }));
    expect(await navigator.clipboard.readText()).toBe(long);
    expect(await screen.findByText('Copied CommandLine')).toBeInTheDocument();

    rerender({ row: row('h1', { CommandLine: long }, 4) });
    expect(
      fields().getByRole('button', { name: 'Show all (1,301 characters)' }),
    ).toBeInTheDocument();
    expect(fields().queryByRole('button', { name: 'Show less' })).not.toBeInTheDocument();
  });

  it('folds Comments and history, and keeps it folded on the next row and the next opening', async () => {
    const { rerender, unmount, user } = renderPanel({ annotations: commented });
    const heading = await screen.findByRole('button', {
      name: /^Comments and history\s*2 comments · 4 entries$/,
    });
    expect(heading).toHaveAttribute('aria-expanded', 'true');
    await user.click(heading);
    expect(heading).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('textbox', { name: 'Comment' })).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'History' })).not.toBeInTheDocument();

    rerender({ row: row('h2', {}, 4), annotations: null });
    expect(await screen.findByRole('button', { name: /^Comments and history/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    unmount();
    renderPanel();
    const again = await screen.findByRole('button', { name: /^Comments and history/ });
    expect(again).toHaveAttribute('aria-expanded', 'false');
    await user.click(again);
    expect(screen.getByRole('textbox', { name: 'Comment' })).toBeInTheDocument();
  });

  it("shows a row without an id with the menu's reason in place of its annotations", () => {
    renderPanel({ row: row(null, { Host: 'h9' }), annotations: null });
    expect(
      within(panel()).getByText('No id: set Id column and run again to annotate'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Comment' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Comments and history' })).not.toBeInTheDocument();
    expect(fields().getByText('h9')).toBeVisible();
    expect(asked).toEqual([]);
  });

  it("gives an action without an Id column param that action's reason", () => {
    renderPanel({ row: row(null, { Host: 'h9' }), annotations: null, idParam: false });
    expect(
      within(panel()).getByText('No id: this action gives its rows no id'),
    ).toBeInTheDocument();
  });
});
