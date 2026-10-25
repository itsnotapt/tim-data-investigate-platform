import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { SideTree } from './SideTree';
import { newTestStore, tab } from '../../test/tabsTestUtils';

const Loc = () => <div data-testid="loc">{useLocation().pathname}</div>;

function renderTree(store = newTestStore(), initial = '/') {
  render(
    <MemoryRouter initialEntries={[initial]}>
      <SideTree store={store} />
      <Routes>
        <Route path="*" element={<Loc />} />
      </Routes>
    </MemoryRouter>,
  );
  return { store };
}
const node = (id: string) => screen.getByTestId(`tree-node-${id}`);
const expand = async () => userEvent.hover(screen.getByLabelText('Query tree'));

describe('SideTree', () => {
  it('shows status icons, badge text and prefixes', async () => {
    const store = newTestStore();
    const s = store.getState();
    s.createTab(tab('draft'));
    s.createTab(tab('exec', null, { state: { isExecuting: true } }));
    s.createTab(tab('err', null, { state: { error: { message: 'boom' } } }));
    s.createTab(tab('new', null, { state: { rowCount: 3 } }));
    s.createTab(tab('many', null, { state: { rowCount: 50, isVisited: true } }));
    renderTree(store);
    await expand();
    const status = (id: string) => within(node(id)).getByTestId('tree-icon');
    expect(status('draft')).toHaveAttribute('data-status', 'draft');
    expect(status('exec')).toHaveAttribute('data-status', 'executing');
    expect(status('err')).toHaveAttribute('data-status', 'error');
    expect(status('new')).toHaveAttribute('data-tone', 'info');
    expect(status('new')).toHaveTextContent('3');
    expect(status('many')).toHaveAttribute('data-tone', 'default');
    expect(status('many')).toHaveTextContent('9+');
    expect(node('draft')).toHaveTextContent('[draft] T-draft');
    expect(node('new')).toHaveTextContent('[new] T-new');
    expect(node('many')).toHaveTextContent(/^9\+T-many$/);
    expect(node('err')).toHaveTextContent(/^ErrorT-err$/);
    expect(node('exec')).toHaveTextContent(/^T-exec$/);
  });

  it('shows a ringed 0 for an action tab whose run succeeded with no rows', async () => {
    const store = newTestStore();
    const action = (componentUuid: string, rowCount: number) =>
      store.getState().createTab({
        componentName: 'ActionResult',
        componentUuid,
        parentUuid: null,
        title: componentUuid,
        params: { action: 'dev-slow', params: {} },
        state: { rowCount },
      });
    action('none', 0);
    action('some', 2);
    renderTree(store);
    await expand();
    const status = (id: string) => within(node(id)).getByTestId('tree-icon');
    expect(status('none')).toHaveAttribute('data-status', 'noRows');
    expect(status('none')).toHaveAccessibleName('Succeeded, no rows');
    expect(status('none')).toHaveTextContent('0');
    expect(status('some')).toHaveAttribute('data-status', 'results');
  });

  it('shows Needs input for an action tab whose pivot still waits for a param', async () => {
    const store = newTestStore();
    const pivot = (componentUuid: string, params: Record<string, unknown>) =>
      store.getState().createTab({
        componentName: 'ActionResult',
        componentUuid,
        parentUuid: null,
        title: componentUuid,
        params: { action: 'dev-slow', params },
        state: { pivotMissing: { result: 'The 2 selected rows have different Result values' } },
      });
    pivot('waiting', {});
    pivot('filled', { result: 'Failure' });
    renderTree(store);
    await expand();
    const status = (id: string) => within(node(id)).getByTestId('tree-icon');
    expect(status('waiting')).toHaveAttribute('data-status', 'needsInput');
    expect(status('waiting')).toHaveAccessibleName('Needs input');
    expect(status('filled')).toHaveAttribute('data-status', 'draft');
  });

  it('click marks visited and navigates', async () => {
    const store = newTestStore();
    store.getState().createTab(tab('a', null, { state: { rowCount: 2 } }));
    renderTree(store);
    await expand();
    await userEvent.click(node('a'));
    expect(store.getState().tabs['a']?.state.isVisited).toBe(true);
    expect(screen.getByTestId('loc')).toHaveTextContent('/view/a');
    expect(node('a')).toHaveTextContent(/^2T-a$/);
  });

  it('highlights the active node on first load', () => {
    const store = newTestStore();
    store.getState().createTab(tab('a'));
    store.getState().createTab(tab('b'));
    renderTree(store, '/view/b');
    expect(node('b')).toHaveAttribute('aria-current', 'page');
    expect(node('b')).toHaveClass('Mui-selected');
    expect(node('a')).not.toHaveAttribute('aria-current');
  });

  it('marks the active tab visited when results arrive', () => {
    const store = newTestStore();
    store.getState().createTab(tab('a'));
    renderTree(store, '/view/a');
    act(() => store.getState().updateState('a', { rowCount: 4 }));
    expect(store.getState().tabs['a']?.state.isVisited).toBe(true);
  });

  it('nests children, collapses, and Remove selected cascades', async () => {
    const store = newTestStore();
    const s = store.getState();
    s.createTab(tab('p'));
    s.createTab(tab('c', 'p'));
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
    // removeSelected awaits each removeTab before it navigates, so wait for both.
    await waitFor(() => expect(Object.keys(store.getState().tabs)).toEqual([]));
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/'));
  });

  it('expands on hover', async () => {
    const store = newTestStore();
    store.getState().createTab(tab('a'));
    renderTree(store);
    expect(screen.queryByLabelText('Select T-a')).not.toBeInTheDocument();
    await expand();
    expect(screen.getByLabelText('Select T-a')).toBeInTheDocument();
  });

  it('collapses on a mouse move outside even without a mouseleave (closed portal menu)', async () => {
    const store = newTestStore();
    store.getState().createTab(tab('a'));
    renderTree(store);
    await expand();
    expect(screen.getByLabelText('Select T-a')).toBeInTheDocument();
    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    });
    expect(screen.queryByLabelText('Select T-a')).not.toBeInTheDocument();
  });

  it('removes the document mousemove listener it added on hover when unmounted', async () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const store = newTestStore();
    store.getState().createTab(tab('a'));
    const { unmount } = render(
      <MemoryRouter>
        <SideTree store={store} />
      </MemoryRouter>,
    );
    await expand();
    const added = add.mock.calls.filter((c) => c[0] === 'mousemove');
    expect(added).toHaveLength(1);
    unmount();
    expect(remove.mock.calls.map((c) => [c[0], c[1]])).toContainEqual(['mousemove', added[0]?.[1]]);
    add.mockRestore();
    remove.mockRestore();
  });
});
