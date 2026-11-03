import 'fake-indexeddb/auto';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GridState } from 'ag-grid-community';
import type { CustomToolPanelProps } from 'ag-grid-react';
import { beforeEach, describe, expect, it } from 'vitest';
import { NotifyContext, type NotifyOptions } from '../../components/notifyContext';
import { content } from '../../test/tabsTestUtils';
import { gridStateChanged } from '../action-tab/model';
import { useTabsStore } from '../tabs';
import { ActionFileToolPanel } from './ActionFileToolPanel';

/** The block the panel is given for a grid state: its column order. */
const actionFile = (state: GridState) =>
  `columns:\n${(state.columnOrder?.orderedColIds ?? []).map((c) => `  - name: ${c}\n`).join('')}`;

const stateWith = (...colIds: string[]): GridState => ({
  partialColumnState: true,
  columnOrder: { orderedColIds: colIds },
});

let clipboard: string | null;
let notes: (NotifyOptions | string)[];

function renderPanel() {
  const tabId = useTabsStore.getState().createTab({
    parentId: null,
    content: content('Sign-ins', {
      toRun: { action: 'dev.sign_ins' },
      grid: { gridState: stateWith('User', 'Host') },
    }),
  });
  const props = {
    context: { columnViews: { tabId }, actionFile },
  } as unknown as CustomToolPanelProps;
  render(
    <NotifyContext.Provider value={(n) => notes.push(n)}>
      <ActionFileToolPanel {...props} />
    </NotifyContext.Provider>,
  );
  return tabId;
}

beforeEach(() => {
  useTabsStore.reset();
  clipboard = null;
  notes = [];
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: (t: string) => {
        clipboard = t;
        return Promise.resolve();
      },
    },
  });
});

const block = () => screen.getByTestId('action-file-tool-panel').querySelector('pre')?.textContent;

describe('ActionFileToolPanel', () => {
  it("shows the tab's columns: block, as the tab's columns change", () => {
    const tabId = renderPanel();
    expect(block()).toBe('columns:\n  - name: User\n  - name: Host\n');
    act(() => useTabsStore.getState().apply(tabId, gridStateChanged(stateWith('Host'))));
    expect(block()).toBe('columns:\n  - name: Host\n');
  });

  it('copies the block', async () => {
    renderPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(clipboard).toBe('columns:\n  - name: User\n  - name: Host\n'));
    expect(notes).toEqual(['Copied the column settings']);
  });
});
