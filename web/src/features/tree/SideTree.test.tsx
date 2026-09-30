import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { SideTree } from './SideTree';
import { kusto, newTestStore } from '../../test/tabsTestUtils';

const Loc = () => <div data-testid="loc">{useLocation().pathname}</div>;

function renderTree(store = newTestStore(), initial = '/', onReload = vi.fn()) {
  render(
    <MemoryRouter initialEntries={[initial]}>
      <SideTree templates={[]} onReloadTemplates={onReload} store={store} />
      <Routes>
        <Route path="*" element={<Loc />} />
      </Routes>
    </MemoryRouter>,
  );
  return { store, onReload };
}
const node = (id: string) => screen.getByTestId(`tree-node-${id}`);
const expand = async () => userEvent.hover(screen.getByLabelText('Query tree'));

describe('SideTree', () => {
  it('shows status icons, badge text and prefixes', async () => {
    const store = newTestStore();
    const s = store.getState();
    s.createTab(kusto('draft'));
    s.createTab(kusto('exec', null, { state: { isExecuting: true } }));
    s.createTab(kusto('err', null, { state: { error: { message: 'boom' } } }));
    s.createTab(kusto('new', null, { state: { rowCount: 3 } }));
    s.createTab(kusto('zero', null, { state: { rowCount: 0 } }));
    s.createTab(kusto('many', null, { state: { rowCount: 50, isVisited: true } }));
    renderTree(store);
    await expand();
    const status = (id: string) => within(node(id)).getByTestId('tree-icon');
    expect(status('draft')).toHaveAttribute('data-status', 'draft');
    expect(status('exec')).toHaveAttribute('data-status', 'executing');
    expect(status('err')).toHaveAttribute('data-status', 'error');
    expect(status('new')).toHaveAttribute('data-tone', 'info');
    expect(status('new')).toHaveTextContent('3');
    expect(status('zero')).toHaveAttribute('data-tone', 'warning');
    expect(status('zero')).toHaveTextContent('0');
    expect(status('many')).toHaveAttribute('data-tone', 'default');
    expect(status('many')).toHaveTextContent('9+');
    expect(node('draft')).toHaveTextContent('[draft] T-draft');
    expect(node('new')).toHaveTextContent('[new] T-new');
    expect(node('many')).toHaveTextContent(/^9\+T-many$/);
    expect(node('err')).toHaveTextContent(/^ErrorT-err$/);
    expect(node('exec')).toHaveTextContent(/^T-exec$/);
  });

  it('click marks visited and navigates', async () => {
    const store = newTestStore();
    store.getState().createTab(kusto('a', null, { state: { rowCount: 2 } }));
    renderTree(store);
    await expand();
    await userEvent.click(node('a'));
    expect(store.getState().tabs['a']?.state.isVisited).toBe(true);
    expect(screen.getByTestId('loc')).toHaveTextContent('/view/a');
    expect(node('a')).toHaveTextContent(/^2T-a$/);
  });

  it('highlights the active node on first load (BUG-21)', () => {
    const store = newTestStore();
    store.getState().createTab(kusto('a'));
    store.getState().createTab(kusto('b'));
    renderTree(store, '/view/b');
    expect(node('b')).toHaveAttribute('aria-current', 'page');
    expect(node('b')).toHaveClass('Mui-selected');
    expect(node('a')).not.toHaveAttribute('aria-current');
  });

  it('marks the active tab visited when results arrive', () => {
    const store = newTestStore();
    store.getState().createTab(kusto('a'));
    renderTree(store, '/view/a');
    act(() => store.getState().updateState('a', { rowCount: 4 }));
    expect(store.getState().tabs['a']?.state.isVisited).toBe(true);
  });

  it('nests children, collapses, and Remove selected cascades', async () => {
    const store = newTestStore();
    const s = store.getState();
    s.createTab(kusto('p'));
    s.createTab(kusto('c', 'p'));
    renderTree(store, '/view/c');
    await expand();
    expect(node('c')).toBeInTheDocument();
    await userEvent.click(within(node('p')).getByLabelText('Collapse'));
    expect(screen.queryByTestId('tree-node-c')).not.toBeInTheDocument();
    await userEvent.click(within(node('p')).getByLabelText('Expand'));

    const remove = screen.getByLabelText('Remove selected');
    expect(remove).toBeDisabled();
    await userEvent.click(screen.getByLabelText('Select T-p'));
    expect(screen.getByLabelText('Select T-c')).toBeChecked();
    await userEvent.click(screen.getByLabelText('Select T-c'));
    expect(screen.getByLabelText('Select T-p')).not.toBeChecked();
    await userEvent.click(screen.getByLabelText('Select T-p'));
    expect(remove).toBeEnabled();
    await userEvent.click(remove);
    expect(Object.keys(store.getState().tabs)).toEqual([]);
    expect(screen.getByTestId('loc')).toHaveTextContent('/');
    expect(screen.getByTestId('loc').textContent).toBe('/');
  });

  it('Reload templates calls onReload', async () => {
    const { onReload } = renderTree();
    await userEvent.click(screen.getByLabelText('Reload templates'));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('expands on hover', async () => {
    const store = newTestStore();
    store.getState().createTab(kusto('a'));
    renderTree(store);
    expect(screen.queryByLabelText('Select T-a')).not.toBeInTheDocument();
    await expand();
    expect(screen.getByLabelText('Select T-a')).toBeInTheDocument();
  });

  it('collapses on a mouse move outside even without a mouseleave (closed portal menu)', async () => {
    const store = newTestStore();
    store.getState().createTab(kusto('a'));
    renderTree(store);
    await expand();
    expect(screen.getByLabelText('Select T-a')).toBeInTheDocument();
    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    });
    expect(screen.queryByLabelText('Select T-a')).not.toBeInTheDocument();
  });
});
