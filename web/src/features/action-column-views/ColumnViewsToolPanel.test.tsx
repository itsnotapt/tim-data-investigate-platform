import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GridState } from 'ag-grid-community';
import type { CustomToolPanelProps } from 'ag-grid-react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NotifyContext, type NotifyOptions } from '../../components/notifyContext';
import type { CatalogueAction, ColumnView } from '../../lib/api';
import { resetTimDb } from '../../lib/storage';
import { apiUrl } from '../../test/msw/handlers';
import { setupMswServer } from '../../test/msw/server';
import { configureTestApp, resetTestApp } from '../../test/testApp';
import { useInstanceStore } from '../instance';
import { usePresetsStore } from '../presets';
import { useTabsStore } from '../tabs';
import { ColumnViewsToolPanel } from './ColumnViewsToolPanel';
import { useDefaultViewsStore } from './defaultViewsStore';
import { useSavedColumnViewsStore } from './savedColumnViewsStore';
import type { ColumnViewController } from './useActionColumnView';

const server = setupMswServer();

const ME = 'alice@example.com';
const SIGN_INS = 'dev.sign_ins';
const HOSTS = 'dev.hosts';

const action = (key: string, name: string): CatalogueAction => ({
  key,
  kind: 'query',
  actionFile: false,
  name,
  menuPath: [],
  connections: [],
  params: [],
  pivot: null,
});

const stateWith = (...colIds: string[]) => ({
  partialColumnState: true,
  columnOrder: { orderedColIds: colIds },
});
/** The tab's columns when it shows the Built-in view. */
const BUILT_IN_STATE = stateWith('User', 'Host', 'Result');
/** The tab's columns once the analyst moved them. */
const EDITED = stateWith('Result', 'Host', 'User');

let nextId = 0;
function view(name: string, over: Partial<ColumnView> = {}): ColumnView {
  nextId += 1;
  return {
    viewId: `00000000-0000-4000-8000-${String(nextId).padStart(12, '0')}`,
    name,
    owner: ME,
    owned: true,
    visibility: 'private',
    hidden: false,
    savedFrom: { action: SIGN_INS },
    state: stateWith('Host', 'User', 'Result'),
    createdAt: '2026-10-01T08:00:00Z',
    updatedAt: '2026-10-01T08:00:00Z',
    ...over,
  };
}

/** The column views the API lists. */
let served: ColumnView[];
/** The bodies of the column view writes the panel made, as `METHOD path`. */
let writes: { call: string; body: Record<string, unknown> }[];
let notes: (NotifyOptions | string)[];

/**
 * A controller that puts a column view on the tab as the grid would: its state, or the Built-in
 * view's for `null`.
 */
function controllerFor(uuid: string): ColumnViewController {
  const tab = () => useTabsStore.getState().tabs[uuid]!.state;
  const put = (state: GridState, columnView: { viewId: string | null; name: string }) =>
    useTabsStore.getState().updateState(uuid, {
      gridState: state,
      columnView: { ...columnView, baseline: state },
    });
  return {
    uuid,
    pick: (v) =>
      v
        ? put(v.state, { viewId: v.viewId, name: v.name })
        : put(BUILT_IN_STATE, { viewId: null, name: 'Built-in' }),
    revert: () => {
      const picked = tab().columnView;
      if (picked) useTabsStore.getState().updateState(uuid, { gridState: picked.baseline });
    },
    current: () => tab().gridState ?? null,
  };
}

/** Renders the panel of a Sign-ins tab showing `showing` (the Built-in view for `null`). */
function renderPanel(showing: ColumnView | null = null) {
  const uuid = useTabsStore.getState().createTab({
    componentName: 'ActionResult',
    parentUuid: null,
    title: 'Sign-ins',
    params: { action: SIGN_INS, params: {} },
  });
  const controller = controllerFor(uuid);
  controller.pick(showing);
  const props = { context: { columnViews: controller } } as unknown as CustomToolPanelProps;
  render(
    <NotifyContext.Provider value={(n) => notes.push(n)}>
      <ColumnViewsToolPanel {...props} />
    </NotifyContext.Provider>,
  );
  return uuid;
}

const tabOf = (uuid: string) => useTabsStore.getState().tabs[uuid]!.state;
/** Edits the tab's columns, so it no longer matches its column view. */
const edit = (uuid: string) =>
  act(() => useTabsStore.getState().updateState(uuid, { gridState: EDITED }));

const saveDialog = () => screen.getByRole('dialog', { name: 'Save column view' });

/** Opens a row's ⋯ menu; returns it with the names of its items. */
async function moreMenu(name: string) {
  await userEvent.click(await screen.findByRole('button', { name: `More for ${name}` }));
  const menu = screen.getByRole('menu', { name });
  return {
    menu,
    items: within(menu)
      .getAllByRole('menuitem')
      .map((i) => i.textContent),
  };
}
async function chooseFromMenu(name: string, item: string) {
  const { menu } = await moreMenu(name);
  await userEvent.click(within(menu).getByRole('menuitem', { name: item }));
}
const defaultEntry = () => useDefaultViewsStore.getState().defaults[`action:${SIGN_INS}`];

const list = () => screen.getByRole('list', { name: 'Column views' });
/** The rows of the list, each as its text. */
const rows = () =>
  within(list())
    .getAllByRole('listitem')
    .map((li) => li.textContent);

beforeEach(async () => {
  await resetTimDb();
  globalThis.indexedDB = new IDBFactory();
  configureTestApp();
  useTabsStore.reset();
  useSavedColumnViewsStore.setState({ views: [], loaded: false, error: null });
  usePresetsStore.setState({ presets: [] });
  useInstanceStore.setState({
    instance: {
      version: 'test',
      actions: [action(SIGN_INS, 'Sign-ins'), action(HOSTS, 'Hosts')],
      connections: [],
      labels: [],
      limits: {
        maxResultRows: 1,
        maxResultBytes: 1,
        maxPivotRows: 1,
        rowsPageSize: 1,
        runTimeoutSeconds: 1,
        maxAnnotationIds: 1,
        annotationPollSeconds: 30,
      },
    },
  });
  await useDefaultViewsStore.getState().load(ME);
  served = [];
  notes = [];
  writes = [];
  server.use(
    http.get(apiUrl('/api/columnViews'), () => HttpResponse.json(served)),
    http.post(apiUrl('/api/columnViews'), async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      writes.push({ call: 'POST', body });
      return HttpResponse.json({ ...view(body.name as string), ...body }, { status: 201 });
    }),
    http.put(apiUrl('/api/columnViews/:viewId/hidden'), ({ params }) => {
      writes.push({ call: `PUT ${String(params.viewId)}/hidden`, body: {} });
      return new HttpResponse(null, { status: 204 });
    }),
    http.delete(apiUrl('/api/columnViews/:viewId/hidden'), ({ params }) => {
      writes.push({ call: `DELETE ${String(params.viewId)}/hidden`, body: {} });
      return new HttpResponse(null, { status: 204 });
    }),
    http.put(apiUrl('/api/columnViews/:viewId'), async ({ request, params }) => {
      const body = (await request.json()) as Record<string, unknown>;
      writes.push({ call: `PUT ${String(params.viewId)}`, body });
      const was = served.find((v) => v.viewId === params.viewId)!;
      return HttpResponse.json({ ...was, ...body });
    }),
  );
});

afterEach(async () => {
  resetTestApp();
  await resetTimDb();
});

describe('ColumnViewsToolPanel', () => {
  it('lists Built-in first, then the views saved here, then those saved elsewhere with where from', async () => {
    served = [
      view('Triage'),
      view('Hosts first', {
        owned: false,
        owner: 'bob@example.com',
        savedFrom: { action: HOSTS },
        state: stateWith('Host'),
      }),
    ];
    renderPanel();

    await screen.findByText('Saved elsewhere');
    expect(rows()).toEqual([
      "Built-inThe action's own columnsDefault",
      'Triage',
      'Saved elsewhere',
      'Hosts firstFrom Hosts · 1 of 3 columns',
    ]);
    expect(within(list()).getByRole('separator')).toBeInTheDocument();
    expect(within(list()).getByRole('radio', { name: 'Built-in' })).toBeChecked();
    expect(within(list()).getByRole('radio', { name: 'Triage' })).not.toBeChecked();
  });

  describe('switching views while the tab is edited', () => {
    const triage = () => view('Triage');
    async function editedAndPicking(target: string) {
      const shown = triage();
      served = [shown, view('Wide', { state: stateWith('User', 'Result') })];
      const uuid = renderPanel(shown);
      edit(uuid);
      await userEvent.click(await screen.findByRole('radio', { name: target }));
      const dialog = await screen.findByRole('dialog', { name: `Switch to "${target}"?` });
      expect(dialog).toHaveTextContent(
        `Your changes to "Triage" aren't saved. Switching views replaces this tab's columns and filters.`,
      );
      return { uuid, dialog };
    }

    it('keeps the edits on Cancel', async () => {
      const { uuid, dialog } = await editedAndPicking('Wide');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(dialog).not.toBeInTheDocument());
      expect(tabOf(uuid).columnView?.name).toBe('Triage');
      expect(tabOf(uuid).gridState).toEqual(EDITED);
    });

    it('saves and then switches on Save first…', async () => {
      const { uuid, dialog } = await editedAndPicking('Wide');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Save first…' }));
      await userEvent.click(within(saveDialog()).getByRole('button', { name: 'Update "Triage"' }));

      await waitFor(() => expect(tabOf(uuid).columnView?.name).toBe('Wide'));
      expect(writes.map((w) => [w.call.split(' ')[0], w.body.name, w.body.state])).toEqual([
        ['PUT', 'Triage', EDITED],
      ]);
      expect(tabOf(uuid).gridState).toEqual(stateWith('User', 'Result'));
    });

    it('keeps the edits when the Save dialog of Save first… is cancelled', async () => {
      const { uuid, dialog } = await editedAndPicking('Wide');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Save first…' }));
      await userEvent.click(within(saveDialog()).getByRole('button', { name: 'Cancel' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(tabOf(uuid).columnView?.name).toBe('Triage');
      expect(tabOf(uuid).gridState).toEqual(EDITED);
    });

    it('switches on Discard and switch', async () => {
      const { uuid, dialog } = await editedAndPicking('Built-in');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Discard and switch' }));
      await waitFor(() => expect(tabOf(uuid).columnView?.viewId).toBeNull());
      expect(tabOf(uuid).gridState).toEqual(BUILT_IN_STATE);
    });
  });

  it('switches without asking when the tab is not edited', async () => {
    served = [view('Triage')];
    const uuid = renderPanel();
    await userEvent.click(await screen.findByRole('radio', { name: 'Triage' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(tabOf(uuid).columnView?.name).toBe('Triage');
  });

  it("says when the tab's changes aren't saved, and Discard puts the view back", async () => {
    const triage = view('Triage');
    served = [triage];
    const uuid = renderPanel(triage);
    expect(await screen.findByRole('button', { name: 'Save as new view…' })).toBeInTheDocument();
    expect(screen.queryByText(/aren't saved/)).not.toBeInTheDocument();

    edit(uuid);
    expect(screen.getByText(`Your changes to "Triage" aren't saved`)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save as new view…' })).not.toBeInTheDocument();
    expect(rows()[1]).toBe('TriageEdited');

    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(tabOf(uuid).gridState).toEqual(triage.state);
    expect(screen.queryByText(/aren't saved/)).not.toBeInTheDocument();
    expect(rows()[1]).toBe('Triage');
  });

  describe('the Save dialog', () => {
    it('updates your own view while its name is unchanged', async () => {
      const triage = view('Triage');
      served = [triage];
      const uuid = renderPanel(triage);
      edit(uuid);
      await userEvent.click(screen.getByRole('button', { name: 'Save…' }));
      const dialog = saveDialog();
      expect(within(dialog).getByLabelText('Name')).toHaveValue('Triage');
      expect(dialog).toHaveTextContent('Change the name to save a new view instead.');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Update "Triage"' }));

      await waitFor(() => expect(dialog).not.toBeInTheDocument());
      expect(writes).toEqual([
        {
          call: `PUT ${triage.viewId}`,
          body: { name: 'Triage', visibility: 'private', state: EDITED },
        },
      ]);
      expect(tabOf(uuid).columnView).toEqual({
        viewId: triage.viewId,
        name: 'Triage',
        baseline: EDITED,
      });
    });

    it('saves a new view once the name is changed, and leaves yours as it is', async () => {
      const triage = view('Triage');
      served = [triage];
      const uuid = renderPanel(triage);
      edit(uuid);
      await userEvent.click(screen.getByRole('button', { name: 'Save…' }));
      const dialog = saveDialog();
      await userEvent.type(within(dialog).getByLabelText('Name'), ' wide');
      expect(dialog).toHaveTextContent('Saves a new view. "Triage" stays as it is.');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Save new view' }));

      await waitFor(() => expect(dialog).not.toBeInTheDocument());
      expect(writes).toEqual([
        {
          call: 'POST',
          body: {
            name: 'Triage wide',
            visibility: 'private',
            state: EDITED,
            savedFrom: { action: SIGN_INS },
          },
        },
      ]);
      expect(tabOf(uuid).columnView?.name).toBe('Triage wide');
      expect(tabOf(uuid).columnView?.viewId).not.toBe(triage.viewId);
    });

    it("saves someone else's view as a new one of your own, with no hint", async () => {
      const theirs = view('Theirs', {
        owned: false,
        owner: 'bob@example.com',
        visibility: 'shared',
      });
      served = [theirs];
      const uuid = renderPanel(theirs);
      edit(uuid);
      await userEvent.click(screen.getByRole('button', { name: 'Save…' }));
      const dialog = saveDialog();
      expect(within(dialog).getByLabelText('Name')).toHaveValue('Theirs');
      expect(within(dialog).getByLabelText('Share with everyone')).not.toBeChecked();
      expect(dialog).not.toHaveTextContent(/new view instead|stays as it is/);
      await userEvent.click(within(dialog).getByRole('button', { name: 'Save new view' }));

      await waitFor(() => expect(writes.map((w) => w.call)).toEqual(['POST']));
    });

    it('starts Save as new view… with an empty name, and always saves a new view', async () => {
      const triage = view('Triage');
      served = [triage];
      renderPanel(triage);
      await userEvent.click(await screen.findByRole('button', { name: 'Save as new view…' }));
      const dialog = saveDialog();
      expect(within(dialog).getByLabelText('Name')).toHaveValue('');
      expect(within(dialog).getByRole('button', { name: 'Save new view' })).toBeDisabled();
      await userEvent.type(within(dialog).getByLabelText('Name'), 'Triage');
      expect(dialog).not.toHaveTextContent(/new view instead|stays as it is/);
      await userEvent.click(within(dialog).getByRole('button', { name: 'Save new view' }));

      await waitFor(() => expect(writes.map((w) => w.call)).toEqual(['POST']));
    });
  });

  describe('the Default view', () => {
    it('is Built-in when none is set, which has no ⋯ button then', async () => {
      served = [view('Triage')];
      renderPanel();
      await screen.findByText('Triage');
      expect(rows()[0]).toMatch(/Default$/);
      expect(
        within(list()).getByLabelText('Opens with this view whenever you run "Sign-ins"'),
      ).toHaveTextContent('Default');
      expect(screen.queryByRole('button', { name: 'More for Built-in' })).not.toBeInTheDocument();
    });

    it('moves to a view with Make default, even while the tab is edited', async () => {
      const triage = view('Triage');
      served = [triage];
      const uuid = renderPanel();
      edit(uuid);
      expect((await moreMenu('Triage')).items).toEqual([
        'Make default',
        'Rename…',
        'Hide from this list',
        'Delete…',
      ]);
      await userEvent.click(screen.getByRole('menuitem', { name: 'Make default' }));

      await waitFor(() => expect(defaultEntry()?.viewId).toBe(triage.viewId));
      expect(rows()[0]).not.toMatch(/Default$/);
      expect(rows()[1]).toMatch(/^Triage.*Default$/);
      expect(notes).toContain('"Sign-ins" now opens with "Triage".');
      expect(tabOf(uuid).gridState).toEqual(EDITED);
    });

    it('goes back to Built-in with Stop using as default, or with Make default on Built-in', async () => {
      const triage = view('Triage');
      served = [triage];
      renderPanel();
      await chooseFromMenu('Triage', 'Make default');
      await waitFor(() => expect(defaultEntry()).toBeDefined());

      expect((await moreMenu('Triage')).items).toEqual([
        'Stop using as default',
        'Rename…',
        'Hide from this list',
        'Delete…',
      ]);
      await userEvent.click(screen.getByRole('menuitem', { name: 'Stop using as default' }));
      await waitFor(() => expect(defaultEntry()).toBeUndefined());
      expect(notes).toContain('"Sign-ins" now opens with "Built-in".');

      await chooseFromMenu('Triage', 'Make default');
      await waitFor(() => expect(defaultEntry()).toBeDefined());
      expect((await moreMenu('Built-in')).items).toEqual(['Make default']);
      await userEvent.click(screen.getByRole('menuitem', { name: 'Make default' }));
      await waitFor(() => expect(defaultEntry()).toBeUndefined());
      expect(rows()[0]).toMatch(/Default$/);
    });

    it("offers only Make default and Hide from this list on someone else's view", async () => {
      served = [view('Theirs', { owned: false, owner: 'bob@example.com' })];
      renderPanel();
      expect((await moreMenu('Theirs')).items).toEqual(['Make default', 'Hide from this list']);
    });

    it('is the saved view when Make it the default is ticked', async () => {
      const triage = view('Triage');
      served = [triage];
      const uuid = renderPanel(triage);
      edit(uuid);
      await userEvent.click(screen.getByRole('button', { name: 'Save…' }));
      const dialog = saveDialog();
      await userEvent.click(within(dialog).getByLabelText('Make it the default for "Sign-ins"'));
      await userEvent.click(within(dialog).getByRole('button', { name: 'Update "Triage"' }));

      await waitFor(() => expect(defaultEntry()?.viewId).toBe(triage.viewId));
      expect(notes).toContain('"Sign-ins" now opens with "Triage".');
    });
  });

  it("renames your own view and changes its sharing, leaving its columns and the tab's edits alone", async () => {
    const triage = view('Triage');
    served = [triage];
    const uuid = renderPanel(triage);
    await chooseFromMenu('Triage', 'Make default');
    await waitFor(() => expect(defaultEntry()).toBeDefined());
    edit(uuid);

    await chooseFromMenu('Triage', 'Rename…');
    const dialog = screen.getByRole('dialog', { name: 'Rename "Triage"' });
    const name = within(dialog).getByLabelText('Name');
    expect(name).toHaveValue('Triage');
    await userEvent.clear(name);
    await userEvent.type(name, 'Triage by host');
    await userEvent.click(within(dialog).getByLabelText('Share with everyone'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(writes).toEqual([
      {
        call: `PUT ${triage.viewId}`,
        body: { name: 'Triage by host', visibility: 'shared', state: triage.state },
      },
    ]);
    expect(rows()[1]).toMatch(/^Triage by hostEdited/);
    expect(tabOf(uuid).columnView).toEqual({
      viewId: triage.viewId,
      name: 'Triage by host',
      baseline: triage.state,
    });
    expect(tabOf(uuid).gridState).toEqual(EDITED);
    expect(defaultEntry()?.name).toBe('Triage by host');
  });

  describe('hidden views', () => {
    it('are left out, with Show N hidden views under the list only when some are hidden', async () => {
      const triage = view('Triage');
      served = [triage, view('Wide')];
      renderPanel();
      await screen.findByText('Triage');
      expect(screen.queryByRole('button', { name: /hidden view/ })).not.toBeInTheDocument();

      await chooseFromMenu('Triage', 'Hide from this list');
      await waitFor(() => expect(rows()).toEqual([expect.stringMatching(/^Built-in/), 'Wide']));
      await userEvent.click(screen.getByRole('button', { name: 'Show 1 hidden view' }));
      expect(rows()).toEqual([expect.stringMatching(/^Built-in/), 'Triage', 'Wide']);

      await chooseFromMenu('Triage', 'Show in this list');
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: /hidden view/ })).not.toBeInTheDocument(),
      );
      expect(writes.map((w) => w.call)).toEqual([
        `PUT ${triage.viewId}/hidden`,
        `DELETE ${triage.viewId}/hidden`,
      ]);
    });

    it("toggles with Don't show hidden views, and counts them", async () => {
      served = [view('A', { hidden: true }), view('B', { hidden: true }), view('C')];
      renderPanel();
      await userEvent.click(await screen.findByRole('button', { name: 'Show 2 hidden views' }));
      expect(rows()).toHaveLength(4);
      await userEvent.click(screen.getByRole('button', { name: "Don't show hidden views" }));
      expect(rows()).toHaveLength(2);
    });

    it('still lists the view the tab shows and the Default view', async () => {
      const shown = view('Shown', { hidden: true });
      const byDefault = view('By default', { hidden: true });
      served = [shown, byDefault, view('Other', { hidden: true })];
      await useDefaultViewsStore.getState().makeDefault({ action: SIGN_INS }, byDefault);
      renderPanel(shown);
      await screen.findByRole('button', { name: 'Show 1 hidden view' });
      expect(rows()).toEqual(["Built-inThe action's own columns", 'By defaultDefault', 'Shown']);
    });
  });
});
