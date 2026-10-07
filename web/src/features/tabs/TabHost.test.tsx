import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { act, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTimDb } from '../../lib/storage';
import { MAX_MOUNTED_TABS, touchLru } from './lru';
import { TabHost } from './TabHost';
import type { TabComponentProps, TabRegistry } from './tabRegistry';
import { useTabsStore } from './tabStore';

const mounts = vi.fn<(kind: string, uuid: string) => void>();

function Probe({ kind, uuid }: { kind: string; uuid: string }) {
  const title = useTabsStore((s) => s.tabs[uuid]?.title);
  // Runs once per mount.
  useMountLog(kind, uuid);
  return <p>{`${kind}:${title}`}</p>;
}
import { useEffect } from 'react';
function useMountLog(kind: string, uuid: string) {
  useEffect(() => {
    mounts(kind, uuid);
  }, [kind, uuid]);
}
const registry: TabRegistry = {
  KustoQueryResult: (p: TabComponentProps) => <Probe kind="kusto" uuid={p.uuid} />,
  TemplateQueryResult: (p: TabComponentProps) => <Probe kind="template" uuid={p.uuid} />,
};

function renderAt(entry: string) {
  const router = createMemoryRouter(
    [
      { path: '/', element: <p>home</p> },
      { path: '/view/:uuid', element: <TabHost registry={registry} /> },
    ],
    { initialEntries: [entry] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const kusto = (componentUuid: string, title = componentUuid) =>
  ({
    componentUuid,
    componentName: 'KustoQueryResult',
    parentUuid: null,
    title,
    params: { query: 'T', cluster: '', database: '' },
  }) as const;

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  await resetTimDb();
  useTabsStore.reset();
  mounts.mockClear();
});
afterEach(async () => {
  await useTabsStore.getState().flush();
  useTabsStore.reset();
  await resetTimDb();
});

describe('touchLru', () => {
  it('moves to the end and evicts the oldest beyond the cap', () => {
    expect(touchLru(['a', 'b', 'c'], 'a')).toEqual(['b', 'c', 'a']);
    expect(touchLru(['a', 'b', 'c'], 'd', 3)).toEqual(['b', 'c', 'd']);
    const many = Array.from({ length: MAX_MOUNTED_TABS }, (_, i) => `t${i}`);
    const next = touchLru(many, 'new');
    expect(next).toHaveLength(MAX_MOUNTED_TABS);
    expect(next[0]).toBe('t1');
  });
});

describe('TabHost', () => {
  it('renders the tab on a hard load once tabs are loaded', async () => {
    const router = renderAt('/view/a');
    // Not loaded yet: no redirect, nothing rendered.
    expect(router.state.location.pathname).toBe('/view/a');
    act(() => {
      useTabsStore.getState().createTab(kusto('a', 'Alpha'));
      useTabsStore.setState({ loaded: true });
    });
    expect(await screen.findByText('kusto:Alpha')).toBeVisible();
    expect(router.state.location.pathname).toBe('/view/a');
    expect(useTabsStore.getState().tabs['a']?.state.isVisited).toBe(true);
  });

  it('redirects an unknown uuid to / only after load finished', async () => {
    const router = renderAt('/view/nope');
    expect(router.state.location.pathname).toBe('/view/nope');
    act(() => useTabsStore.setState({ loaded: true }));
    expect(await screen.findByText('home')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });

  it('keeps visited tabs mounted and hidden, without remounting', async () => {
    useTabsStore.getState().createTab(kusto('a'));
    useTabsStore.getState().createTab(kusto('b'));
    useTabsStore.setState({ loaded: true });
    const router = renderAt('/view/a');
    expect(await screen.findByText('kusto:a')).toBeVisible();
    await act(() => router.navigate('/view/b'));
    expect(screen.getByText('kusto:b')).toBeVisible();
    expect(screen.getByText('kusto:a')).not.toBeVisible();
    await act(() => router.navigate('/view/a'));
    expect(screen.getByText('kusto:a')).toBeVisible();
    expect(screen.getByText('kusto:b')).not.toBeVisible();
    expect(mounts.mock.calls).toEqual([
      ['kusto', 'a'],
      ['kusto', 'b'],
    ]);
  });

  it('remounts with the new component when the tab is converted', async () => {
    useTabsStore.getState().createTab({
      componentUuid: 't',
      componentName: 'TemplateQueryResult',
      parentUuid: null,
      title: 'T',
      params: { inParams: {}, queryTemplate: {} },
    });
    useTabsStore.setState({ loaded: true });
    renderAt('/view/t');
    expect(await screen.findByText('template:T')).toBeInTheDocument();
    act(() =>
      useTabsStore.getState().convertToKusto('t', { query: 'Q', cluster: '', database: '' }),
    );
    expect(await screen.findByText('kusto:T')).toBeInTheDocument();
    expect(screen.queryByText('template:T')).not.toBeInTheDocument();
    expect(mounts.mock.calls.map((c) => c[0])).toEqual(['template', 'kusto']);
  });

  it('drops a removed tab from the mounted set', async () => {
    useTabsStore.getState().createTab(kusto('a'));
    useTabsStore.getState().createTab(kusto('b'));
    useTabsStore.setState({ loaded: true });
    const router = renderAt('/view/a');
    await screen.findByText('kusto:a');
    await act(() => router.navigate('/view/b'));
    await act(() => useTabsStore.getState().removeTab('a'));
    expect(screen.queryByText('kusto:a')).not.toBeInTheDocument();
    expect(screen.getByText('kusto:b')).toBeVisible();
  });
});
