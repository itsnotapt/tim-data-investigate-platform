import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppBarSlotProvider } from '../../components/AppBarSlot';
import { SnackbarHost } from '../../components/SnackbarHost';
import { resetTimDb } from '../../lib/storage';
import { results, tab } from '../../test/tabsTestUtils';
import { MAX_MOUNTED_TABS, touchLru } from './lru';
import { TabHost } from './TabHost';
import { useTabsStore } from './tabStore';

function renderAt(entry: string) {
  const router = createMemoryRouter(
    [
      { path: '/', element: <p>home</p> },
      { path: '/view/:tabId', element: <TabHost /> },
    ],
    { initialEntries: [entry] },
  );
  render(
    <SnackbarHost>
      <AppBarSlotProvider>
        <RouterProvider router={router} />
      </AppBarSlotProvider>
    </SnackbarHost>,
  );
  return router;
}

/** A tab whose run stored `rowCount` rows, so it shows "Results · <rowCount>" and Run. */
const ran = (id: string, rowCount: number) => tab(id, null, { results: results(rowCount) });

/** The visible tab's inner tab named `name`; hidden tabs' inner tabs are not found. */
const innerTab = (name: string) => screen.queryByRole('tab', { name });

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  await resetTimDb();
  useTabsStore.reset();
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
  it('shows the tab on a hard load once tabs are loaded, and marks it visited', async () => {
    const router = renderAt('/view/a');
    // Not loaded yet: no redirect, nothing shown.
    expect(router.state.location.pathname).toBe('/view/a');
    act(() => {
      useTabsStore.getState().createTab(ran('a', 2));
      useTabsStore.setState({ loaded: true });
    });
    expect(await screen.findByRole('tab', { name: 'Results · 2' })).toBeVisible();
    expect(router.state.location.pathname).toBe('/view/a');
    expect(useTabsStore.getState().tabs['a']?.visited).toBe(true);
  });

  it('redirects an unknown tab id to / only after load finished', async () => {
    const router = renderAt('/view/nope');
    expect(router.state.location.pathname).toBe('/view/nope');
    act(() => useTabsStore.setState({ loaded: true }));
    expect(await screen.findByText('home')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });

  it('keeps a visited tab as the analyst left it, hidden while another is shown', async () => {
    useTabsStore.getState().createTab(ran('a', 2));
    useTabsStore.getState().createTab(ran('b', 3));
    useTabsStore.setState({ loaded: true });
    const router = renderAt('/view/a');
    await userEvent.click(await screen.findByRole('tab', { name: 'Run' }));

    await act(() => router.navigate('/view/b'));
    expect(innerTab('Results · 3')).toHaveAttribute('aria-selected', 'true');
    expect(innerTab('Results · 2')).not.toBeInTheDocument();

    await act(() => router.navigate('/view/a'));
    // Still on the inner tab the analyst picked: the tab was not mounted again.
    expect(innerTab('Run')).toHaveAttribute('aria-selected', 'true');
    expect(innerTab('Results · 3')).not.toBeInTheDocument();
  });

  it('drops a removed tab', async () => {
    useTabsStore.getState().createTab(ran('a', 2));
    useTabsStore.getState().createTab(ran('b', 3));
    useTabsStore.setState({ loaded: true });
    const router = renderAt('/view/a');
    await screen.findByRole('tab', { name: 'Results · 2' });
    await act(() => router.navigate('/view/b'));
    await act(() => useTabsStore.getState().removeTab('a'));
    expect(
      screen.queryByRole('tab', { name: 'Results · 2', hidden: true }),
    ).not.toBeInTheDocument();
    expect(innerTab('Results · 3')).toBeVisible();
  });
});
