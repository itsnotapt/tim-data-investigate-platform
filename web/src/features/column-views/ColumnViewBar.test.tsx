import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { columnViewsDao, resetTimDb } from '../../lib/storage';
import { ColumnViewBar, type ColumnStateApi } from './ColumnViewBar';
import { useColumnViewsStore } from './columnViewsStore';

const live = [{ colId: 'A', width: 100 }];
function makeApi() {
  const applyColumnState = vi.fn(() => true);
  const api: ColumnStateApi = { getColumnState: () => live, applyColumnState };
  return Object.assign(api, { applySpy: applyColumnState });
}

beforeEach(async () => {
  await resetTimDb();
  globalThis.indexedDB = new IDBFactory();
  useColumnViewsStore.setState({ views: [], loaded: false });
});

async function seed() {
  await columnViewsDao.put({ uuid: 'v1', name: 'Beta', columnState: [{ colId: 'B' }] });
  await columnViewsDao.put({
    uuid: 'v2',
    name: 'Alpha',
    columnState: [{ colId: 'A', hide: true }],
  });
  await useColumnViewsStore.getState().load();
}

async function pick(name: string) {
  await userEvent.click(screen.getByLabelText('Column view'));
  await userEvent.click(await screen.findByRole('option', { name }));
}

describe('ColumnViewBar', () => {
  it('disables actions without a selection', () => {
    render(<ColumnViewBar api={makeApi()} />);
    for (const name of [
      'Apply column view',
      'Rename column view',
      'Delete column view',
      'Save this column view',
    ]) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
  });

  it('creates a view from the typed name with the current column state', async () => {
    const api = makeApi();
    render(<ColumnViewBar api={api} />);
    await userEvent.type(screen.getByLabelText('Column view'), ' My view ');
    await userEvent.click(await screen.findByText('Create column view'));
    await waitFor(() => expect(useColumnViewsStore.getState().views).toHaveLength(1));
    expect(useColumnViewsStore.getState().views[0]).toMatchObject({
      name: 'My view',
      columnState: live,
    });
    expect(await columnViewsDao.list()).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Apply column view' })).toBeEnabled();
  });

  it('applies the selected view with order', async () => {
    await seed();
    const api = makeApi();
    render(<ColumnViewBar api={api} />);
    await pick('Alpha');
    await userEvent.click(screen.getByRole('button', { name: 'Apply column view' }));
    expect(api.applySpy).toHaveBeenCalledWith({
      state: [{ colId: 'A', hide: true }],
      applyOrder: true,
    });
  });

  it('saves the live column state into the selected view', async () => {
    await seed();
    render(<ColumnViewBar api={makeApi()} />);
    await pick('Beta');
    await userEvent.click(screen.getByRole('button', { name: 'Save this column view' }));
    await waitFor(async () =>
      expect((await columnViewsDao.list()).find((v) => v.uuid === 'v1')?.columnState).toEqual(live),
    );
  });

  it('renames the selected view', async () => {
    await seed();
    render(<ColumnViewBar api={makeApi()} />);
    await pick('Alpha');
    await userEvent.click(screen.getByRole('button', { name: 'Rename column view' }));
    const dialog = await screen.findByRole('dialog');
    const field = within(dialog).getByLabelText('Rename column view');
    expect(field).toHaveValue('Alpha');
    await userEvent.clear(field);
    await userEvent.type(field, 'Zulu');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rename' }));
    await waitFor(() =>
      expect(useColumnViewsStore.getState().views.map((v) => v.name)).toEqual(['Beta', 'Zulu']),
    );
    expect((await columnViewsDao.list()).map((v) => v.name)).toEqual(['Beta', 'Zulu']);
  });

  it('confirms deletion with corrected text (BUG-41) and clears the selection', async () => {
    await seed();
    render(<ColumnViewBar api={makeApi()} />);
    await pick('Alpha');
    await userEvent.click(screen.getByRole('button', { name: 'Delete column view' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Delete column view')).toBeInTheDocument();
    expect(
      within(dialog).getByText('Are you sure you wish to delete "Alpha"?'),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(useColumnViewsStore.getState().views.map((v) => v.uuid)).toEqual(['v1']),
    );
    expect((await columnViewsDao.list()).map((v) => v.uuid)).toEqual(['v1']);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Apply column view' })).toBeDisabled(),
    );
  });

  it('Close leaves the view in place', async () => {
    await seed();
    render(<ColumnViewBar api={makeApi()} />);
    await pick('Alpha');
    await userEvent.click(screen.getByRole('button', { name: 'Delete column view' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(useColumnViewsStore.getState().views).toHaveLength(2);
  });
});
