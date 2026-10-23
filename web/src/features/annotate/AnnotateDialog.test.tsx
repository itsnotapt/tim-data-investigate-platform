import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiClient, type Annotations, type InstanceLabel } from '../../lib/api';
import { apiUrl, problemResponse, TEST_API } from '../../test/msw/handlers';
import { setupMswServer } from '../../test/msw/server';
import { AnnotateDialog, type AnnotateDialogProps } from './AnnotateDialog';

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

const annotations = (id: string, tags: string[], key: string | null = null): Annotations => ({
  id,
  label: key === null ? null : { key, by: 'bob@example.com', at: '2026-10-21T10:00:00Z' },
  tags,
  comments: [],
  version: 1,
});

let patches: unknown[] = [];
let prefixes: string[] = [];

beforeEach(() => {
  patches = [];
  prefixes = [];
  server.use(
    http.patch(apiUrl('/api/annotations'), async ({ request }) => {
      patches.push(await request.json());
      return HttpResponse.json({ changes: [annotations('h1', ['c2'])], version: 2 });
    }),
    http.get(apiUrl('/api/tags/suggestions'), ({ request }) => {
      prefixes.push(new URL(request.url).searchParams.get('prefix') ?? '');
      return HttpResponse.json({ recent: ['botnet', 'beacon'], mostUsed: ['banking', 'c2'] });
    }),
  );
});

function renderDialog(props: Partial<AnnotateDialogProps> = {}) {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(
    <AnnotateDialog
      mode="annotate"
      targets={['h1', 'h2', 'h3']}
      reach={{ rows: 4, ids: 3, otherRows: 2, withoutId: 1 }}
      current={[annotations('h1', ['c2', 'beacon'], 'malicious'), annotations('h2', ['c2'])]}
      rowTags={['bad', 'beacon']}
      labels={labels}
      onSaved={onSaved}
      onClose={onClose}
      call={call}
      {...props}
    />,
  );
  return { onSaved, onClose, user: userEvent.setup() };
}

const save = () => screen.getByRole('button', { name: 'Save' });

describe('AnnotateDialog', () => {
  it("states the change's reach and the targets' label now", () => {
    renderDialog();
    expect(
      screen.getByText(
        '4 rows · 3 ids · also changes 2 other rows with the same id · 1 row without an id is skipped',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Now: 1 Malicious · 2 no label')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep' })).toHaveAttribute('aria-pressed', 'true');
    expect(save()).toBeDisabled();
  });

  it('shows a partial tag dashed with its count, and a click adds it to all', async () => {
    const { user, onSaved, onClose } = renderDialog();
    const partial = screen.getByRole('button', { name: 'beacon 1/3' });
    expect(partial).toHaveStyle({ borderStyle: 'dashed' });
    expect(screen.getByRole('button', { name: 'c2 2/3' })).toBeInTheDocument();
    await user.click(partial);
    expect(screen.queryByRole('button', { name: 'beacon 1/3' })).toBeNull();
    expect(screen.getByRole('button', { name: 'beacon' })).toBeInTheDocument();
    await user.click(save());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(patches).toEqual([{ ids: ['h1', 'h2', 'h3'], addTags: ['beacon'] }]);
    expect(onSaved).toHaveBeenCalledWith([annotations('h1', ['c2'])]);
  });

  it('strikes a removed tag through, and a click on it undoes the removal', async () => {
    const { user } = renderDialog();
    await user.click(screen.getByLabelText('Remove c2'));
    const removed = screen.getByRole('button', { name: 'c2' });
    expect(removed).toHaveStyle({ textDecoration: 'line-through' });
    expect(save()).toBeEnabled();
    await user.click(removed);
    expect(screen.getByRole('button', { name: 'c2 2/3' })).toBeInTheDocument();
    expect(save()).toBeDisabled();
  });

  it('sets the label, adds a typed tag, removes one and comments in one change', async () => {
    const { user, onClose } = renderDialog();
    await user.click(screen.getByRole('button', { name: 'Benign' }));
    await user.type(screen.getByRole('combobox', { name: 'Add tag' }), ' ransomware {Enter}');
    expect(screen.getByRole('button', { name: 'ransomware' })).toBeInTheDocument();
    await user.click(screen.getByLabelText('Remove beacon'));
    await user.type(screen.getByRole('textbox', { name: 'Comment' }), 'beacons every 60s');
    await user.click(save());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(patches).toEqual([
      {
        ids: ['h1', 'h2', 'h3'],
        label: 'benign',
        addTags: ['ransomware'],
        removeTags: ['beacon'],
        comment: 'beacons every 60s',
      },
    ]);
  });

  it('clears the label with Clear', async () => {
    const { user, onClose } = renderDialog();
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    await user.click(save());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(patches).toEqual([{ ids: ['h1', 'h2', 'h3'], label: null }]);
  });

  it("groups the suggestions: on these rows, the analyst's recent tags, then the most used", async () => {
    const { user } = renderDialog();
    await user.type(screen.getByRole('combobox', { name: 'Add tag' }), 'b');
    const listbox = await screen.findByRole('listbox');
    await waitFor(() => expect(prefixes).toContain('b'));
    await waitFor(() =>
      expect(
        within(listbox)
          .getAllByRole('option')
          .map((o) => o.textContent),
      ).toEqual(['bad', 'botnet', 'banking']),
    );
    expect(within(listbox).getByText('On these rows')).toBeInTheDocument();
    expect(within(listbox).getByText('Your recent tags')).toBeInTheDocument();
    expect(within(listbox).getByText('Most used')).toBeInTheDocument();
    await user.click(within(listbox).getByRole('option', { name: 'botnet' }));
    expect(screen.getByRole('button', { name: 'botnet' })).toBeInTheDocument();
  });

  it('saves with Ctrl+Enter, including a tag still being typed', async () => {
    const { user, onClose } = renderDialog();
    await user.type(screen.getByRole('textbox', { name: 'Comment' }), 'seen before');
    await user.type(screen.getByRole('combobox', { name: 'Add tag' }), 'tor');
    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(patches).toEqual([
      { ids: ['h1', 'h2', 'h3'], addTags: ['tor'], comment: 'seen before' },
    ]);
  });

  it('stays open with the error when the change fails', async () => {
    server.use(
      http.patch(apiUrl('/api/annotations'), () =>
        problemResponse(422, {
          type: 'urn:tim:problem:validation',
          detail: 'One or more fields are invalid',
          errors: { addTags: [`At most 100 characters: ${'x'.repeat(101)}`] },
        }),
      ),
    );
    const { user, onClose, onSaved } = renderDialog();
    await user.type(screen.getByRole('textbox', { name: 'Comment' }), 'note');
    await user.click(save());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      `Couldn't save: At most 100 characters: ${'x'.repeat(101)}`,
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Comment' })).toHaveValue('note');
  });

  it('as Comment…, has only the comment', async () => {
    const { user, onClose } = renderDialog({ mode: 'comment' });
    expect(screen.getByRole('dialog', { name: 'Comment' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Add tag' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Keep' })).toBeNull();
    await user.type(screen.getByRole('textbox', { name: 'Comment' }), 'checked with the owner');
    await user.click(save());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(patches).toEqual([{ ids: ['h1', 'h2', 'h3'], comment: 'checked with the owner' }]);
  });
});
