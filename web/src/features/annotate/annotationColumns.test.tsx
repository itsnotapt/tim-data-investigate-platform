import { render, screen } from '@testing-library/react';
import type { ColDef, ICellRendererParams } from 'ag-grid-community';
import type { ComponentType } from 'react';
import { describe, expect, it } from 'vitest';
import type { Annotations } from '../../lib/api';
import { commentsColumnDef, commentTextColumnDef, tagsColumnDef } from './annotationColumns';

const row = (annotations?: Partial<Annotations>) => ({
  _id: '0',
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

describe('the comments column', () => {
  const def = commentsColumnDef();

  it('is shown, valued by the number of comments, with the latest in the tooltip', () => {
    expect(def).toMatchObject({ colId: 'tim:comments' });
    expect(def.hide).toBeUndefined();
    expect(def.initialHide).toBeUndefined();
    expect(value(def, row({ comments }))).toBe(2);
    expect(value(def, row())).toBe(0);
    const tooltip = def.tooltip as (p: { data: unknown }) => string | undefined;
    expect(tooltip({ data: row({ comments }) })).toBe(
      'bob@example.com: beacons every 60s\nto 10.0.0.1',
    );
    expect(tooltip({ data: row() })).toBeUndefined();
  });

  it('shows an icon and the count when there are comments, else nothing', () => {
    const Cell = def.cellRenderer as ComponentType<Partial<ICellRendererParams>>;
    const { rerender } = render(<Cell value={2} />);
    expect(screen.getByLabelText('2 comments')).toHaveTextContent('2');
    rerender(<Cell value={0} />);
    expect(screen.queryByLabelText(/comments?$/)).toBeNull();
  });
});
