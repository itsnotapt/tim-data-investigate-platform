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
import type { LabelledRow } from '../labels';
import { HistoryPanel, type HistoryPanelProps } from './HistoryPanel';

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

const row = (id: string | null, data: Record<string, unknown> = {}): LabelledRow => ({
  row: 0,
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

function renderPanel(props: Partial<HistoryPanelProps> = {}) {
  const onCommented = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <HistoryPanel
      row={row('h1', { Host: 'h1', Bytes: 2048, Empty: '' })}
      annotations={annotations}
      labels={labels}
      onCommented={onCommented}
      onClose={onClose}
      call={call}
      {...props}
    />,
  );
  return { ...view, onCommented, onClose, user: userEvent.setup() };
}

const panel = () => screen.getByRole('complementary', { name: 'History' });
const historyItems = () =>
  within(screen.getByRole('list', { name: 'History' }))
    .getAllByRole('listitem')
    .map((item) => item.textContent);

describe('HistoryPanel', () => {
  it("shows the id, its label with who and when, its tags and the row's fields", async () => {
    renderPanel();
    const p = within(panel());
    expect(p.getByText('h1', { selector: 'code' })).toBeInTheDocument();
    expect(p.getByText('Malicious')).toBeInTheDocument();
    expect(p.getByText('bob@example.com · 2026-10-21 10:05 UTC')).toBeInTheDocument();
    expect(p.getByText('beacon')).toBeInTheDocument();
    expect(p.getByText('c2')).toBeInTheDocument();
    const fields = within(p.getByRole('region', { name: 'Fields' }));
    expect(fields.getByText('Bytes')).toBeInTheDocument();
    expect(fields.getByText('2048')).toBeInTheDocument();
    expect(fields.queryByText('Empty')).not.toBeInTheDocument();
    await screen.findByRole('list', { name: 'History' });
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

  it('adds a comment to the id with Ctrl+Enter, then reads the history again', async () => {
    const { onCommented, user } = renderPanel();
    await screen.findByRole('list', { name: 'History' });
    const box = screen.getByRole('textbox', { name: 'Comment' });
    await user.type(box, '  same C2 as h2 ');
    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(onCommented).toHaveBeenCalledWith([{ ...annotations, version: 5 }]));
    expect(patches).toEqual([{ ids: ['h1'], comment: 'same C2 as h2' }]);
    await waitFor(() => expect(box).toHaveValue(''));
    await waitFor(() => expect(asked).toEqual(['h1', 'h1']));
  });

  it('keeps the comment and shows why when adding it fails', async () => {
    server.use(
      http.patch(apiUrl('/api/annotations'), () =>
        problemResponse(422, { errors: { comment: ["A comment can't be blank"] } }),
      ),
    );
    const { onCommented, user } = renderPanel();
    await user.type(screen.getByRole('textbox', { name: 'Comment' }), 'x');
    await user.click(screen.getByRole('button', { name: 'Add comment' }));
    expect(await screen.findByText(/Couldn't add the comment/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Comment' })).toHaveValue('x');
    expect(onCommented).not.toHaveBeenCalled();
  });

  it('reads the history again when the id or its annotations change', async () => {
    const { rerender } = renderPanel();
    await waitFor(() => expect(asked).toEqual(['h1']));
    const props = { labels, onCommented: vi.fn(), onClose: vi.fn(), call };
    rerender(
      <HistoryPanel {...props} row={row('h1')} annotations={{ ...annotations, version: 6 }} />,
    );
    await waitFor(() => expect(asked).toEqual(['h1', 'h1']));
    rerender(<HistoryPanel {...props} row={row('h2')} annotations={null} />);
    await waitFor(() => expect(asked).toEqual(['h1', 'h1', 'h2']));
    expect(screen.getByText('No label')).toBeInTheDocument();
  });

  it("starts afresh on another id: no half-typed comment, no earlier id's history", async () => {
    let answer: (() => void) | null = null;
    const { rerender, user } = renderPanel();
    await screen.findByRole('list', { name: 'History' });
    await user.type(screen.getByRole('textbox', { name: 'Comment' }), 'about h1');
    server.use(
      http.get(
        apiUrl('/api/annotations/history'),
        () =>
          new Promise<Response>((resolve) => {
            answer = () => resolve(HttpResponse.json({ entries: [] }));
          }),
      ),
    );
    const props = { labels, onCommented: vi.fn(), onClose: vi.fn(), call };
    rerender(<HistoryPanel {...props} row={row('h2')} annotations={null} />);
    expect(screen.getByRole('textbox', { name: 'Comment' })).toHaveValue('');
    expect(screen.queryByRole('list', { name: 'History' })).not.toBeInTheDocument();
    await waitFor(() => expect(answer).not.toBeNull());
    answer!();
    expect(await screen.findByRole('list', { name: 'History' })).toBeEmptyDOMElement();
  });

  it('says a row without an id has no history, and still shows its fields', () => {
    renderPanel({ row: row(null, { Host: 'h9' }), annotations: null });
    expect(screen.getByText('This row has no id.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Comment' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Fields' })).getByText('h9')).toBeVisible();
    expect(asked).toEqual([]);
  });
});
