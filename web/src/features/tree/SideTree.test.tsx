import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { SideTree } from './SideTree';
import { newTestStore, results, tab } from '../../test/tabsTestUtils';

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
    s.createTab(tab('exec', null, { status: { executing: true } }));
    s.createTab(tab('err', null, { status: { error: { message: 'boom' } } }));
    s.createTab(tab('new', null, { results: results(3) }));
    s.createTab(tab('many', null, { results: results(50) }));
    s.markVisited('many');
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

  it('shows a 0 badge, toned like the row-count badge, for an action tab whose run succeeded with no rows', async () => {
    const store = newTestStore();
    const action = (id: string, rowCount: number) =>
      store.getState().createTab(tab(id, null, { results: results(rowCount) }));
    action('none', 0);
    action('seen', 0);
    store.getState().markVisited('seen');
    action('some', 2);
    renderTree(store);
    await expand();
    const status = (id: string) => within(node(id)).getByTestId('tree-icon');
    expect(status('none')).toHaveAttribute('data-status', 'noRows');
    expect(status('none')).toHaveAccessibleName('Succeeded, no rows');
    expect(status('none')).toHaveTextContent('0');
    expect(status('none')).toHaveAttribute('data-tone', 'info');
    expect(status('seen')).toHaveAttribute('data-tone', 'default');
    expect(status('seen')).toHaveTextContent('0');
    expect(status('some')).toHaveAttribute('data-status', 'results');
  });

  it('shows Needs input for an action tab whose pivot still waits for a param', async () => {
    const store = newTestStore();
    const pivot = (id: string, params: Record<string, unknown>, missing = 'result') =>
      store.getState().createTab(
        tab(id, null, {
          toRun: { action: 'dev-slow', params },
          status: {
            pivotMissing: { [missing]: 'The 2 selected rows have different Result values' },
          },
        }),
      );
    pivot('waiting', {});
    pivot('filled', { result: 'Failure' });
    const parameter = (value: string | null) => ({
      parameters: [{ name: 'Result', type: 'string', value }],
    });
    pivot('waitingParameter', parameter(null), 'parameters.Result');
    pivot('filledParameter', parameter('Failure'), 'parameters.Result');
    renderTree(store);
    await expand();
    const status = (id: string) => within(node(id)).getByTestId('tree-icon');
    expect(status('waiting')).toHaveAttribute('data-status', 'needsInput');
    expect(status('waiting')).toHaveAccessibleName('Needs input');
    expect(status('filled')).toHaveAttribute('data-status', 'draft');
    expect(status('waitingParameter')).toHaveAttribute('data-status', 'needsInput');
    expect(status('filledParameter')).toHaveAttribute('data-status', 'draft');
  });

  it("titles a tab that has run by its latest run, in full in a tooltip and the checkbox's name", async () => {
    const store = newTestStore();
    const title = `Host timeline ${'BGIST-L '.repeat(20).trim()}`;
    store.getState().createTab(tab('ran', null, { latest: { title } }));
    store.getState().markVisited('ran');
    renderTree(store);
    await expand();
    expect(node('ran')).toHaveTextContent(title);
    expect(
      within(node('ran')).getByRole('checkbox', { name: `Select ${title}` }),
    ).toBeInTheDocument();
    await userEvent.hover(within(node('ran')).getByText(title));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(title);
  });

  it('click marks visited and navigates', async () => {
    const store = newTestStore();
    store.getState().createTab(tab('a', null, { results: results(2) }));
    renderTree(store);
    await expand();
    await userEvent.click(node('a'));
    expect(store.getState().tabs['a']?.visited).toBe(true);
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
    act(() => store.getState().apply('a', (t) => ({ ...t, results: results(4) })));
    expect(store.getState().tabs['a']?.visited).toBe(true);
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

  it('has no New of its own, and shows its header only while open', async () => {
    const store = newTestStore();
    store.getState().createTab(tab('a'));
    renderTree(store);
    const tree = within(screen.getByLabelText('Query tree'));
    expect(tree.queryByRole('button', { name: /new/i })).not.toBeInTheDocument();
    expect(tree.getByText('Queries')).not.toBeVisible();
    expect(tree.queryByRole('button', { name: 'Remove selected' })).not.toBeInTheDocument();
    await expand();
    expect(tree.getByText('Queries')).toBeVisible();
    expect(tree.getByRole('button', { name: 'Remove selected' })).toBeDisabled();
    expect(tree.queryByRole('button', { name: /new/i })).not.toBeInTheDocument();
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
