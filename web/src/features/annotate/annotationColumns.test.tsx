import { render, screen, within } from '@testing-library/react';
import type { ColDef } from 'ag-grid-community';
import type { ComponentType } from 'react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Annotations } from '../../lib/api';
import { commentsColumnDef, commentTextColumnDef, tagsColumnDef } from './annotationColumns';

const row = (annotations?: Partial<Annotations>) => ({
  id: 'h1',
  ...(annotations && {
    annotations: { id: 'h1', label: null, tags: [], comments: [], version: 1, ...annotations },
  }),
});

const comments = [
  { author: 'alice@example.com', at: '2026-10-21T10:00:00Z', text: 'first look' },
  { author: 'bob@example.com', at: '2026-10-21T11:00:00Z', text: 'beacons every 60s\nto 10.0.0.1' },
];

type Getter = (p: { data: unknown }) => unknown;
const value = (def: ColDef, data: unknown) => (def.valueGetter as Getter)({ data });

describe('the Tags column', () => {
  const def = tagsColumnDef();

  it('is hidden, groupable and filtered by a set filter', () => {
    expect(def).toMatchObject({
      colId: 'tim:tags',
      headerName: 'Tags',
      initialHide: true,
      enableRowGroup: true,
      filter: 'agSetColumnFilter',
    });
  });

  it("gives the row's tags, so the set filter lists each tag once", () => {
    expect(value(def, row({ tags: ['beacon', 'c2'] }))).toEqual(['beacon', 'c2']);
    expect(value(def, row())).toEqual([]);
  });

  it('names rows without tags "(no tags)" in the set filter', () => {
    const { valueFormatter: format } = def.filterParams as {
      valueFormatter: (p: { value: unknown }) => string;
    };
    expect(format({ value: null })).toBe('(no tags)');
    expect(format({ value: 'c2' })).toBe('c2');
  });

  it('groups by the set of tags, joined', () => {
    const key = def.keyCreator as (p: { value: unknown }) => string;
    expect(key({ value: ['beacon', 'c2'] })).toBe('beacon, c2');
    expect(key({ value: [] })).toBe('(no tags)');
  });
});

describe('the Comment text column', () => {
  const def = commentTextColumnDef();

  it("is hidden and text-filtered over every comment's text", () => {
    expect(def).toMatchObject({
      colId: 'tim:commentText',
      headerName: 'Comment text',
      initialHide: true,
      filter: 'agTextColumnFilter',
    });
    expect(value(def, row({ comments }))).toBe('first look\nbeacons every 60s\nto 10.0.0.1');
    expect(value(def, row())).toBeNull();
  });
});

describe('the Comment column', () => {
  const ALICE = 'alice@example.com';
  const saveComment = vi.fn();
  const def = commentsColumnDef({ analyst: ALICE, saveComment });
  const carols = { author: 'carol@example.com', at: '2026-10-21T12:00:00Z', text: 'tor exit' };
  const noId = { id: null };

  type Props = Record<string, unknown>;
  const renderCell = (data: unknown) => {
    const Cell = def.cellRenderer as ComponentType<Props>;
    return render(<Cell data={data} {...(def.cellRendererParams as Props)} />);
  };
  const tooltip = (data: unknown) =>
    (def.tooltip as (p: { data: unknown }) => string | undefined)({ data });

  beforeEach(() => saveComment.mockReset());

  it('is shown as Comment, 280 px wide, and text-filtered on the text it shows', () => {
    expect(def).toMatchObject({
      colId: 'tim:comments',
      headerName: 'Comment',
      width: 280,
      filter: 'agTextColumnFilter',
    });
    expect(def.initialHide).toBeUndefined();
    expect(value(def, row({ comments }))).toBe('first look');
    expect(value(def, row({ comments: comments.slice(1) }))).toBe(
      'bob: beacons every 60s\nto 10.0.0.1',
    );
    expect(value(def, row())).toBeNull();
    expect(value(def, noId)).toBeNull();
  });

  it('shows your comment, with a line break as ⏎ and +N for the others', () => {
    renderCell(row({ comments: [comments[1]!, { ...comments[0]!, text: 'first\nlook' }] }));
    expect(screen.getByText('first ⏎ look')).not.toHaveStyle({ fontStyle: 'italic' });
    expect(screen.getByText('+1')).toBeInTheDocument();
  });

  it('shows the latest other comment dimmed and italic without yours, and counts the rest', () => {
    renderCell(row({ comments: [comments[1]!, carols] }));
    expect(screen.getByText('carol: tor exit')).toHaveStyle({ fontStyle: 'italic' });
    expect(screen.getByText('+1')).toBeInTheDocument();
  });

  it('shows nothing without comments or an id', () => {
    const { container, rerender } = renderCell(row());
    expect(container).toHaveTextContent('');
    const Cell = def.cellRenderer as ComponentType<Props>;
    rerender(<Cell data={noId} {...(def.cellRendererParams as Props)} />);
    expect(container).toHaveTextContent('');
  });

  it('lists every current comment in the tooltip, yours first, with author and time', () => {
    expect(tooltip(row({ comments: [...comments, carols] }))).toBe(
      [
        `${ALICE} · 2026-10-21 10:00 UTC\nfirst look`,
        'bob@example.com · 2026-10-21 11:00 UTC\nbeacons every 60s\nto 10.0.0.1',
        'carol@example.com · 2026-10-21 12:00 UTC\ntor exit',
      ].join('\n\n'),
    );
    expect(tooltip(noId)).toBe("This row has no id, so it can't have comments.");
  });

  it('edits only a row with an id; a letter does not start an edit, and Shift+Enter does not end one', () => {
    const editable = def.editable as (p: { data: unknown }) => boolean;
    expect(editable({ data: row() })).toBe(true);
    expect(editable({ data: noId })).toBe(false);
    const suppress = def.suppressKeyboardEvent as (p: {
      editing: boolean;
      event: Partial<KeyboardEvent>;
    }) => boolean;
    for (const key of ['t', 'C', 'd', '3']) {
      expect(suppress({ editing: false, event: { key } })).toBe(true);
    }
    for (const key of ['Enter', 'F2', 'ArrowDown']) {
      expect(suppress({ editing: false, event: { key } })).toBe(false);
    }
    expect(suppress({ editing: false, event: { key: 'c', ctrlKey: true } })).toBe(false);
    expect(suppress({ editing: true, event: { key: 'Enter', shiftKey: true } })).toBe(true);
    for (const key of ['Enter', 'Escape', 't']) {
      expect(suppress({ editing: true, event: { key, shiftKey: false } })).toBe(false);
    }
  });

  describe('its editor', () => {
    const renderEditor = (data: unknown) => {
      const Editor = def.cellEditor as ComponentType<Props>;
      const onValueChange = vi.fn();
      const stopEditing = vi.fn();
      render(
        <Editor
          data={data}
          onValueChange={onValueChange}
          stopEditing={stopEditing}
          {...(def.cellEditorParams as Props)}
        />,
      );
      return { onValueChange, stopEditing, user: userEvent.setup() };
    };
    const box = () => screen.getByRole('textbox', { name: 'Your comment on h1' });

    it("opens with your comment, never another's, and the others' read-only below it", () => {
      renderEditor(row({ comments: [comments[1]!, carols] }));
      expect(box()).toHaveValue('');
      expect(
        within(screen.getByRole('list', { name: 'Other comments' }))
          .getAllByRole('listitem')
          .map((item) => item.textContent),
      ).toEqual(['carol: tor exit', 'bob: beacons every 60s\nto 10.0.0.1']);
    });

    it('saves with Enter, and Shift+Enter is a new line', async () => {
      const { onValueChange, stopEditing, user } = renderEditor(row({ comments }));
      expect(box()).toHaveValue('first look');
      await user.clear(box());
      await user.type(box(), 'same C2{Shift>}{Enter}{/Shift}as h2');
      expect(stopEditing).not.toHaveBeenCalled();
      expect(box()).toHaveValue('same C2\nas h2');
      expect(onValueChange).toHaveBeenLastCalledWith('same C2\nas h2');
      await user.keyboard('{Enter}');
      expect(stopEditing).toHaveBeenCalledWith();
    });
  });

  it('saves your trimmed text, or clears it when blank, and nothing when unchanged', () => {
    const set = (data: unknown, newValue: unknown) =>
      (def.valueSetter as (p: { data: unknown; newValue: unknown }) => boolean)({
        data,
        newValue,
      });
    expect(set(row({ comments }), ' same C2 ')).toBe(false);
    expect(set(row({ comments }), '  ')).toBe(false);
    expect(set(row({ comments }), 'first look ')).toBe(false);
    expect(set(noId, 'x')).toBe(false);
    expect(saveComment.mock.calls).toEqual([
      ['h1', 'same C2'],
      ['h1', ''],
    ]);
  });
});
