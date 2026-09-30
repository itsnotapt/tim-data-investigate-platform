import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MenuItemDef } from 'ag-grid-community';
import type { QueryTemplate } from '../../lib/api';
import { resetConfigCache } from '../../lib/config/runtimeConfig';
import { newTestStore } from '../../test/tabsTestUtils';
import { useTemplatesStore } from '../templates';
import * as runModule from '../template-query/runTemplateQuery';
import { createPivotTab } from './createPivotTab';
import { buildPivotMenuItems, type OnPivot, type PivotActionParams } from './pivotMenu';
import { usePivotMenu } from './usePivotMenu';

let n = 0;
function tpl(over: Partial<QueryTemplate> = {}): QueryTemplate {
  n += 1;
  return {
    uuid: `u${n}`,
    name: `n${n}`,
    menu: `Menu ${n}`,
    summary: 'Logons of {{user}}',
    path: [],
    queryType: 'query',
    cluster: 'c',
    database: 'd',
    query: 'T | where U in ({{array users}})',
    fields: { user: { type: 'text' } },
    isDeleted: false,
    isManaged: false,
    createdBy: 'x',
    updatedBy: 'x',
    updated: '2024-01-01T00:00:00Z',
    ...over,
  };
}

const names = (items: MenuItemDef[]): string[] => items.map((i) => i.name);
const sub = (item: MenuItemDef | undefined): MenuItemDef[] => {
  const s = item?.subMenu ?? [];
  return s.filter((x): x is MenuItemDef => typeof x !== 'string');
};

const fakeParams = (row: object, selected: object[] = []): PivotActionParams => ({
  node: { data: row },
  api: { getSelectedNodes: () => selected.map((data) => ({ data })) },
});
const act1 = (item: MenuItemDef | undefined, p: PivotActionParams) =>
  (item?.action as ((p: PivotActionParams) => void) | undefined)?.(p);

vi.mock('../template-query/runTemplateQuery', () => ({
  runTemplateQuery: vi.fn(() => Promise.resolve()),
}));

beforeEach(() => {
  window.appConfig = {
    auth: { clientId: 'id', authority: 'https://login.example.com/t' },
    redirectUri: 'https://tim.example.com/blank.html',
    tagCluster: 'https://tags.kusto.windows.net',
  };
  resetConfigCache();
});

describe('buildPivotMenuItems', () => {
  it('nests by path, sorted, skipping hidden and non-query templates', () => {
    const items = buildPivotMenuItems(
      [
        tpl({ menu: 'Zed', path: [] }),
        tpl({ menu: 'B2', path: ['User', 'Sub'] }),
        tpl({ menu: 'B1', path: ['User'] }),
        tpl({ menu: 'A1', path: ['Machine'] }),
        tpl({ menu: 'Aaa', path: [] }),
        tpl({ menu: 'Other', queryType: 'chart' as QueryTemplate['queryType'] }),
        tpl({ uuid: 'hidden', menu: 'Hidden' }),
      ],
      { hidden: { hide: true } },
      vi.fn(),
    );
    expect(names(items)).toEqual(['Machine', 'User', 'Aaa', 'Zed']);
    expect(names(sub(items[0]))).toEqual(['A1']);
    expect(names(sub(items[1]))).toEqual(['Sub', 'B1']);
    expect(names(sub(sub(items[1])[0]))).toEqual(['B2']);
  });

  it('reports the clicked row and the selected rows (clicked row when none selected)', () => {
    const onPivot = vi.fn<OnPivot>();
    const t = tpl({ menu: 'One' });
    const [item] = buildPivotMenuItems([t], {}, onPivot);
    act1(item, fakeParams({ user: 'a' }));
    expect(onPivot).toHaveBeenLastCalledWith({
      template: t,
      row: { user: 'a' },
      selectedRows: [{ user: 'a' }],
    });
    act1(item, fakeParams({ user: 'a' }, [{ user: 'a' }, { user: 'b' }]));
    expect(onPivot.mock.lastCall?.[0].selectedRows).toHaveLength(2);
  });
});

describe('createPivotTab', () => {
  const store = newTestStore();
  beforeEach(() => {
    store.reset();
    store.getState().createTab({
      componentUuid: 'parent',
      componentName: 'KustoQueryResult',
      parentUuid: null,
      title: 'P',
      params: { query: 'T', cluster: '', database: '' },
    });
  });

  const base = { parentUuid: 'parent', store } as const;
  const multi = tpl({ fields: { users: { type: 'multiple', from: 'user' } } });

  it('multi-select fills the multiple field and auto-runs a complete child without navigating', async () => {
    const run = vi.fn(() => Promise.resolve());
    const navigate = vi.fn();
    const uuid = await createPivotTab({
      ...base,
      template: multi,
      row: { user: 'a' },
      selectedRows: [{ user: 'a' }, { user: 'b' }, { user: '' }],
      run,
      navigate,
    });
    const tab = store.getState().tabs[uuid];
    expect(tab?.parentUuid).toBe('parent');
    expect(tab?.componentName).toBe('TemplateQueryResult');
    if (tab?.componentName !== 'TemplateQueryResult') throw new Error('kind');
    expect(tab.params.inParams['users']).toEqual(['a', 'b']);
    expect(tab.state.editQuery).toBe(false);
    expect(run).toHaveBeenCalledWith(uuid);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('incomplete data opens edit mode, does not run and navigates', async () => {
    const run = vi.fn(() => Promise.resolve());
    const navigate = vi.fn();
    const uuid = await createPivotTab({
      ...base,
      template: tpl(),
      row: { other: 1 },
      run,
      navigate,
    });
    expect(store.getState().tabs[uuid]?.state.editQuery).toBe(true);
    expect(run).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(`/view/${uuid}`);
  });

  it('autoExecute=false creates in edit mode without running', async () => {
    const run = vi.fn(() => Promise.resolve());
    const uuid = await createPivotTab({
      ...base,
      template: tpl(),
      row: { user: 'a' },
      autoExecute: false,
      run,
    });
    expect(store.getState().tabs[uuid]?.state.editQuery).toBe(true);
    expect(store.getState().tabs[uuid]?.title).toBe('Logons of a');
    expect(run).not.toHaveBeenCalled();
  });
});

describe('usePivotMenu shift handling', () => {
  const store = newTestStore();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter>{children}</MemoryRouter>
  );
  beforeEach(() => {
    vi.mocked(runModule.runTemplateQuery).mockClear();
    store.reset();
    store.getState().createTab({
      componentUuid: 'parent',
      componentName: 'KustoQueryResult',
      parentUuid: null,
      title: 'P',
      params: { query: 'T', cluster: '', database: '' },
    });
    useTemplatesStore.setState({ templates: [tpl({ menu: 'Go' })], queryOptions: {} });
  });

  const children = () =>
    Object.values(store.getState().tabs).filter((t) => t.parentUuid === 'parent');

  it('Shift held: child in edit mode; released: not edit mode (auto-run)', async () => {
    const { result } = renderHook(() => usePivotMenu('parent', store), { wrapper });
    const items = () => result.current({} as never) as MenuItemDef[];
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }));
    });
    act1(items()[0], fakeParams({ user: 'a' }));
    await vi.waitFor(() => expect(children()).toHaveLength(1));
    expect(children()[0]?.state.editQuery).toBe(true);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift' }));
    });
    act1(items()[0], fakeParams({ user: 'b' }));
    await vi.waitFor(() => expect(children()).toHaveLength(2));
    expect(children()[1]?.state.editQuery).toBe(false);
    expect(runModule.runTemplateQuery).toHaveBeenCalledTimes(1);
  });
});
