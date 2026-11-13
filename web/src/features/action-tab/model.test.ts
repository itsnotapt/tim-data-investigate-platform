import type { GridState } from 'ag-grid-community';
import { describe, expect, it } from 'vitest';
import type { CatalogueAction, Preset, Run } from '../../lib/api';
import type { TabContent } from '../../lib/storage';
import {
  cancelFailed,
  cancelRequested,
  cloneOf,
  columnViewPicked,
  columnViewRenamed,
  isEdited,
  fromAction,
  fromPivot,
  fromPreset,
  fromShareLink,
  gridStateChanged,
  idColumnOf,
  idColumnSwitched,
  linkedRowShown,
  linkIdColumnOf,
  paramEdited,
  paramsReset,
  resumed,
  runFailed,
  runRefused,
  runStarted,
  runStarting,
  runSucceeded,
  runUpdated,
  savedAsPreset,
  stalled,
  runTitleOf,
  stillNeeded,
  titleOf,
} from './model';

const HOST_TIMELINE: CatalogueAction = {
  key: 'host-timeline',
  kind: 'query',
  actionFile: true,
  findPivotRows: false,
  name: 'Host timeline',
  menuPath: ['Endpoint'],
  connections: [],
  idColumn: 'EventId',
  pivot: null,
  params: [
    { name: 'host', kind: 'string', required: true, many: false },
    { name: 'limit', kind: 'number', required: true, many: false, default: 10 },
  ],
};

const MY_HOSTS: Preset = {
  presetId: 'p-1',
  name: 'My hosts',
  menuPath: [],
  owner: 'alice@example.com',
  visibility: 'private',
  owned: true,
  hidden: false,
  action: 'host-timeline',
  params: {},
  idColumn: 'Host',
  title: 'My hosts: {host}',
  inputs: [
    { name: 'host', source: 'param', fixed: false, fromColumns: ['Host'] },
    { name: 'limit', source: 'param', fixed: true, value: 5 },
  ],
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
};

const RUNNING: Run = {
  runId: 'r-1',
  action: { key: 'host-timeline', name: 'Host timeline' },
  params: { host: 'web01', limit: 10 },
  title: 'Host timeline web01',
  owner: 'alice@example.com',
  status: 'running',
  startedAt: '2026-11-02T10:00:00Z',
  expiresAt: '2026-11-03T10:00:00Z',
};

describe('opening a tab', () => {
  it('from an action holds its params, titled with its name, and has not run', () => {
    const tab = fromAction(HOST_TIMELINE, { limit: 10 });
    expect(tab.title).toBe('Host timeline');
    expect(tab.toRun).toEqual({ action: 'host-timeline', params: { limit: 10 } });
    expect(tab.latest).toEqual({ run: null, params: null, title: null });
    expect(tab.results).toBeNull();
    expect(tab.status.executing).toBe(false);
  });

  it("from a preset holds its id, its title template and its Id column, and waits for what's missing", () => {
    const tab = fromPreset(MY_HOSTS, HOST_TIMELINE, {
      params: { limit: 5 },
      missing: { host: null },
    });
    expect(tab.title).toBe('My hosts');
    expect(tab.toRun).toEqual({
      action: 'host-timeline',
      params: { limit: 5 },
      presetId: 'p-1',
      titleTemplate: 'My hosts: {host}',
    });
    expect(tab.grid.idColumn).toBe('Host');
    expect(tab.status.pivotMissing).toEqual({ host: null });
  });

  it('from a preset with nothing missing waits for nothing', () => {
    const tab = fromPreset({ ...MY_HOSTS, idColumn: null }, HOST_TIMELINE, {
      params: { host: 'web01', limit: 5 },
      missing: {},
    });
    expect(tab.status.pivotMissing).toBeNull();
    expect(tab.grid).not.toHaveProperty('idColumn');
  });

  it("from a pivot holds the pivot rows and their ids, and waits for what's missing, with why", () => {
    const tab = fromPivot({
      action: HOST_TIMELINE,
      params: { limit: 10 },
      missing: { host: 'No Host in the rows' },
      pivotRows: [{ Host: 'web01' }],
      pivotRowIds: ['e1', null],
    });
    expect(tab.title).toBe('Host timeline');
    expect(tab.toRun).toEqual({
      action: 'host-timeline',
      params: { limit: 10 },
      pivotRows: [{ Host: 'web01' }],
      pivotRowIds: ['e1', null],
    });
    expect(tab.status.pivotMissing).toEqual({ host: 'No Host in the rows' });
  });

  it('from a pivot with a preset is titled and keyed by the preset', () => {
    const tab = fromPivot({
      action: HOST_TIMELINE,
      preset: MY_HOSTS,
      params: { host: 'web01', limit: 5 },
      missing: {},
      pivotRowIds: ['e1'],
    });
    expect(tab.title).toBe('My hosts');
    expect(tab.toRun).toEqual({
      action: 'host-timeline',
      params: { host: 'web01', limit: 5 },
      presetId: 'p-1',
      titleTemplate: 'My hosts: {host}',
      pivotRowIds: ['e1'],
    });
    expect(tab.grid.idColumn).toBe('Host');
    expect(tab.status.pivotMissing).toBeNull();
  });

  it("from a share link holds its run's action and params, follows the run, and names its row", () => {
    const tab = fromShareLink(RUNNING, 3, null);
    expect(tab.title).toBe('Host timeline');
    expect(tab.toRun).toEqual({ action: 'host-timeline', params: { host: 'web01', limit: 10 } });
    expect(tab.latest).toEqual({
      run: RUNNING,
      params: { host: 'web01', limit: 10 },
      title: 'Host timeline web01',
    });
    expect(tab.status).toMatchObject({ executing: true, linkedRow: 3 });
    expect(tab.grid).not.toHaveProperty('idColumn');
  });

  it('from a share link that names an Id column uses it', () => {
    expect(fromShareLink(RUNNING, null, 'Host').grid.idColumn).toBe('Host');
  });
});

describe('cloning a tab', () => {
  const pivoted = fromPivot({
    action: HOST_TIMELINE,
    preset: MY_HOSTS,
    params: { host: ['web01', 'web02'], limit: 5 },
    missing: {},
    pivotRows: [{ Host: 'web01' }],
    pivotRowIds: ['e1'],
  });
  const ran = {
    ...pivoted,
    latest: { run: RUNNING, params: pivoted.toRun.params, title: 'My hosts: [web01, web02]' },
    results: { runId: 'r-1', columns: null, startedAt: RUNNING.startedAt, rowCount: 4 },
  };

  it('holds a copy of its params and pivot rows and its Id column, titled Copy of its title, not run', () => {
    const copy = cloneOf(ran);
    expect(copy.title).toBe('Copy of My hosts');
    expect(copy.toRun).toEqual({
      action: 'host-timeline',
      params: { host: ['web01', 'web02'], limit: 5 },
      titleTemplate: 'Copy of My hosts: {host}',
      pivotRows: [{ Host: 'web01' }],
    });
    expect(copy.grid.idColumn).toBe('Host');
    expect(copy.latest).toEqual({ run: null, params: null, title: null });
    expect(copy.results).toBeNull();
  });

  it("of a preset tab keeps its title template, without the preset's id", () => {
    const copy = cloneOf(ran);
    expect(copy.toRun.titleTemplate).toBe('Copy of My hosts: {host}');
    expect(copy.toRun).not.toHaveProperty('presetId');
  });

  it('shares no values with the tab, so editing one leaves the other', () => {
    const copy = cloneOf(ran);
    expect(copy.toRun.params.host).not.toBe(ran.toRun.params.host);
    expect(copy.toRun.pivotRows?.[0]).not.toBe(ran.toRun.pivotRows?.[0]);
  });
});

describe('editing', () => {
  const pivoted = fromPivot({
    action: HOST_TIMELINE,
    params: { host: 'web01', limit: 10 },
    missing: {},
    pivotRows: [{ Host: 'web01' }],
    pivotRowIds: ['e1'],
  });

  it('a param sets its value and drops the pivot rows, so they stop titling its runs', () => {
    const edited = paramEdited('host', 'web02')(pivoted);
    expect(edited.toRun.params).toEqual({ host: 'web02', limit: 10 });
    expect(edited.toRun).not.toHaveProperty('pivotRows');
    expect(edited.toRun.pivotRowIds).toEqual(['e1']);
  });

  it("a param clears why it was refused, and leaves the other params' reasons", () => {
    const refused = {
      ...pivoted,
      status: { ...pivoted.status, paramErrors: { host: 'Unknown host', limit: 'Too big' } },
    };
    expect(paramEdited('host', 'web02')(refused).status.paramErrors).toEqual({ limit: 'Too big' });
  });

  it('a query parameter sets its entry', () => {
    const tab = fromAction(HOST_TIMELINE, {
      parameters: [{ name: 'user', type: 'string', value: null }],
    });
    expect(paramEdited('parameters.user', 'alice')(tab).toRun.params).toEqual({
      parameters: [{ name: 'user', type: 'string', value: 'alice' }],
    });
  });
});

describe('Reset and edited', () => {
  const ran = {
    ...fromAction(HOST_TIMELINE, { host: 'web01', limit: 10 }),
    latest: { run: RUNNING, params: { host: 'web01', limit: 10 }, title: 'Host timeline web01' },
  };
  const pivotedRan = runStarted(RUNNING, {
    params: { host: 'web01', limit: 10 },
    pivotRows: [{ Host: 'web01' }],
  })(
    fromPivot({
      action: HOST_TIMELINE,
      params: { host: 'web01', limit: 10 },
      missing: {},
      pivotRows: [{ Host: 'web01' }],
      pivotRowIds: ['e1'],
    }),
  );
  const changed = {
    ...paramEdited('host', 'web02')(ran),
    status: { ...ran.status, paramErrors: { limit: 'Too big' } },
  };

  it('a tab is edited when its params differ from its latest run’s', () => {
    expect(isEdited(ran)).toBe(false);
    expect(isEdited(changed)).toBe(true);
  });

  it('a tab that has not run is never edited', () => {
    expect(isEdited(fromAction(HOST_TIMELINE, { host: 'web01' }))).toBe(false);
  });

  it('an unset param is the same as a missing one', () => {
    expect(isEdited(paramEdited('extra', '')(ran))).toBe(false);
  });

  it("Reset puts back the latest run's params and clears why params were refused", () => {
    const back = paramsReset(changed);
    expect(back.toRun.params).toEqual({ host: 'web01', limit: 10 });
    expect(back.status.paramErrors).toBeNull();
    expect(isEdited(back)).toBe(false);
  });

  it('Reset puts back the rows the latest run was pivoted from, as well as its params', () => {
    const back = paramsReset(paramEdited('host', 'web02')(pivotedRan));
    expect(back.toRun.params).toEqual({ host: 'web01', limit: 10 });
    expect(back.toRun.pivotRows).toEqual([{ Host: 'web01' }]);
  });

  it('Reset leaves no pivot rows when the latest run had none', () => {
    const second = runStarted(RUNNING, { params: { host: 'web02', limit: 10 } })(
      paramEdited('host', 'web02')(pivotedRan),
    );
    const back = paramsReset(paramEdited('host', 'web03')(second));
    expect(back.toRun.params).toEqual({ host: 'web02', limit: 10 });
    expect(back.toRun).not.toHaveProperty('pivotRows');
  });

  it('Reset leaves a tab that has not run as it is', () => {
    const tab = fromAction(HOST_TIMELINE, { host: 'web01' });
    expect(paramsReset(tab)).toEqual(tab);
  });
});

describe('the Id column', () => {
  const plain = fromAction(HOST_TIMELINE, {});
  const ofPreset = fromPreset(MY_HOSTS, HOST_TIMELINE, { params: {}, missing: {} });

  it("is the action's", () => {
    expect(idColumnOf(plain, HOST_TIMELINE)).toBe('EventId');
  });

  it("is the preset's for a tab opened from one", () => {
    expect(idColumnOf(ofPreset, HOST_TIMELINE)).toBe('Host');
  });

  it("is none when the action has none and the tab hasn't switched", () => {
    expect(idColumnOf(plain, { ...HOST_TIMELINE, idColumn: null })).toBeNull();
    expect(idColumnOf(plain, undefined)).toBeNull();
  });

  it('is the one the analyst switched to, and goes back to the action’s when cleared', () => {
    const switched = idColumnSwitched('User')(ofPreset);
    expect(idColumnOf(switched, HOST_TIMELINE)).toBe('User');
    expect(idColumnOf(idColumnSwitched(null)(switched), HOST_TIMELINE)).toBe('EventId');
  });

  it("a link carries the tab's when it isn't the action's", () => {
    expect(linkIdColumnOf(plain, HOST_TIMELINE)).toBeNull();
    expect(linkIdColumnOf(ofPreset, HOST_TIMELINE)).toBe('Host');
    expect(linkIdColumnOf(idColumnSwitched('EventId')(ofPreset), HOST_TIMELINE)).toBeNull();
  });
});

describe('the title', () => {
  const plain = fromAction(HOST_TIMELINE, {});
  const TITLED: CatalogueAction = { ...HOST_TIMELINE, title: 'Timeline of {host}, {limit} rows' };
  const RUN_KQL: CatalogueAction = {
    ...HOST_TIMELINE,
    key: 'tim.run_kql',
    name: 'Run KQL',
    title: 'Run KQL',
    params: [
      { name: 'database', kind: 'string', required: true, many: false },
      { name: 'parameters', kind: 'json', required: false, many: false },
    ],
  };
  /** `tab` as after a run titled `title`. */
  const ran = (tab: TabContent, title: string | undefined): TabContent =>
    runStarted({ ...RUNNING, title: title ?? tab.title }, tab.toRun)(tab);

  it('is the stored title until the tab has run', () => {
    expect(titleOf(plain)).toBe('Host timeline');
  });

  it("is the latest run's title once the tab has run", () => {
    expect(titleOf(ran(plain, 'Host timeline BGIST-L'))).toBe('Host timeline BGIST-L');
  });

  it("of a run is the action's title template filled in, an unset param with its default", () => {
    const tab = fromAction(TITLED, { host: 'BGIST-L' });
    expect(runTitleOf(tab, TITLED)).toBe('Timeline of BGIST-L, 10 rows');
  });

  it('of a run is none without a title template, so the run is titled with its name', () => {
    expect(runTitleOf(plain, HOST_TIMELINE)).toBeUndefined();
    expect(runTitleOf(plain, undefined)).toBeUndefined();
  });

  it("of a tab from a preset is the preset's template filled in from its params, query parameters and pivot rows", () => {
    const preset: Preset = {
      ...MY_HOSTS,
      action: 'tim.run_kql',
      title: 'Sign-ins of {Upn} in {database} on {row.App} since {Since}',
      inputs: [
        { name: 'Upn', source: 'queryParameter', type: 'string', fixed: false, fromColumns: [] },
        { name: 'Since', source: 'queryParameter', type: 'long', fixed: false, fromColumns: [] },
      ],
    };
    const tab = fromPivot({
      action: RUN_KQL,
      preset,
      params: {
        database: 'Samples',
        parameters: [
          { name: 'Upn', type: 'string', value: 'alice@contoso.com' },
          { name: 'Since', type: 'long', value: null },
        ],
      },
      missing: {},
      pivotRows: [{ App: 'Teams' }],
      pivotRowIds: ['e1'],
    });
    const title = runTitleOf(tab, RUN_KQL);
    expect(title).toBe('Sign-ins of alice@contoso.com in Samples on Teams since <not set>');
    expect(titleOf(ran(tab, title))).toBe(title);
  });

  it('of a tab from a preset keeps the template it opened with when the preset changes', () => {
    const opened = { params: { host: 'web01' }, missing: {} };
    const kept = fromPreset(MY_HOSTS, TITLED, opened);
    const savedOver = savedAsPreset(
      { ...MY_HOSTS, title: 'Hosts {host}' },
      TITLED,
    )(fromPreset(MY_HOSTS, TITLED, opened));
    expect(runTitleOf(kept, TITLED)).toBe('My hosts: web01');
    expect(runTitleOf(savedOver, TITLED)).toBe('Hosts web01');
  });

  it('of a clone of a preset tab is "Copy of" and its source\'s template filled in', () => {
    const tab = fromPreset(MY_HOSTS, TITLED, { params: { host: 'web01' }, missing: {} });
    const clone = cloneOf(ran(tab, 'My hosts: web01'));
    expect(titleOf(clone)).toBe('Copy of My hosts');
    const title = runTitleOf(paramEdited('host', 'web03')(clone), TITLED);
    expect(title).toBe('Copy of My hosts: web03');
  });
});

describe('the params a tab still needs', () => {
  it("are those a pivot left missing that are still unset, in the pivot's order", () => {
    const tab = fromPivot({
      action: HOST_TIMELINE,
      params: { limit: 10 },
      missing: { limit: null, host: 'No Host in the rows' },
      pivotRowIds: [],
    });
    expect(stillNeeded(tab)).toEqual(['host']);
    expect(stillNeeded(paramEdited('host', 'web01')(tab))).toEqual([]);
  });

  it('include a query parameter until its pill is set', () => {
    const tab = fromPreset(MY_HOSTS, HOST_TIMELINE, {
      params: { parameters: [{ name: 'user', type: 'string', value: null }] },
      missing: { 'parameters.user': null },
    });
    expect(stillNeeded(tab)).toEqual(['parameters.user']);
    expect(stillNeeded(paramEdited('parameters.user', 'alice')(tab))).toEqual([]);
  });

  it('are none for a tab that waits for nothing', () => {
    expect(stillNeeded(fromAction(HOST_TIMELINE, {}))).toEqual([]);
  });
});

describe('a run', () => {
  const SUCCEEDED: Run = { ...RUNNING, status: 'succeeded', rowCount: 2, columns: [] };
  /** A tab whose latest run succeeded, showing a share link's row, with a param refused. */
  const ran = {
    ...fromPivot({
      action: HOST_TIMELINE,
      params: { host: 'web01', limit: 10 },
      missing: { host: null },
      pivotRowIds: [],
    }),
    latest: { run: SUCCEEDED, params: { host: 'web01', limit: 10 }, title: 'Host timeline web01' },
  };
  const failed = {
    ...ran,
    status: {
      ...ran.status,
      error: { message: 'The run failed' },
      paramErrors: { limit: 'Too big' },
      linkedRow: 3,
    },
  };

  it('starting executes the tab, clears its error and linked row, and keeps the latest title', () => {
    const starting = runStarting(failed);
    expect(starting.status).toMatchObject({
      executing: true,
      cancelling: false,
      error: null,
      paramErrors: null,
      linkedRow: null,
    });
    expect(starting.latest).toEqual({ ...ran.latest, run: null });
  });

  it('refused for params alone keeps the latest run as it was before it started', () => {
    const refused = runRefused(
      { paramErrors: { limit: 'Too big' }, message: null },
      ran,
    )(runStarting(ran));
    expect(refused.latest.run).toBe(SUCCEEDED);
    expect(refused.status).toMatchObject({
      executing: false,
      error: null,
      paramErrors: { limit: 'Too big' },
    });
  });

  it('refused for any other reason shows it, with no latest run', () => {
    const refused = runRefused(
      { paramErrors: null, message: "Couldn't start: down" },
      ran,
    )(runStarting(ran));
    expect(refused.latest.run).toBeNull();
    expect(refused.status).toMatchObject({
      executing: false,
      error: { message: "Couldn't start: down" },
    });
  });

  it('started is the latest run, with the params it started with and its title, and the tab stops waiting', () => {
    const started = runStarted(RUNNING, { params: { host: 'web01', limit: 10 } })(
      runStarting(paramEdited('limit', 20)(ran)),
    );
    expect(started.latest).toEqual({
      run: RUNNING,
      params: { host: 'web01', limit: 10 },
      title: 'Host timeline web01',
    });
    expect(started.status.pivotMissing).toBeNull();
    expect(started.status.executing).toBe(true);
  });
});

describe('a run that has started', () => {
  const shared = fromShareLink(RUNNING, 3, null);
  const SUCCEEDED: Run = {
    ...RUNNING,
    status: 'succeeded',
    rowCount: 2,
    columns: [{ name: 'Host', type: 'string', declared: true, duplicates: 0 }],
  };

  it('updated is the latest run', () => {
    expect(runUpdated(SUCCEEDED)(shared).latest.run).toBe(SUCCEEDED);
  });

  it("succeeded stores its rows' run, and shows the linked row when its rows have it", () => {
    const done = runSucceeded(SUCCEEDED, [{ row: 1 }, { row: 3 }])(shared);
    expect(done.results).toEqual({
      runId: 'r-1',
      columns: [{ name: 'Host', type: 'string', declared: true, duplicates: 0 }],
      startedAt: '2026-11-02T10:00:00Z',
      rowCount: 2,
    });
    expect(done.status).toMatchObject({
      executing: false,
      cancelling: false,
      error: null,
      linkedRow: 3,
    });
  });

  it("succeeded drops a linked row its rows don't have", () => {
    expect(runSucceeded(SUCCEEDED, [{ row: 1 }])(shared).status.linkedRow).toBeNull();
  });

  it('failed stops the tab executing, shows why, and drops the linked row', () => {
    const cancelling = { ...shared, status: { ...shared.status, cancelling: true } };
    expect(runFailed('The run failed')(cancelling).status).toMatchObject({
      executing: false,
      cancelling: false,
      error: { message: 'The run failed' },
      linkedRow: null,
    });
  });

  it('failed keeps the results of the run before', () => {
    const before = runSucceeded(SUCCEEDED, [])(shared);
    expect(runFailed('The run failed')(runStarting(before)).results).toEqual(before.results);
  });
});

describe('following a run', () => {
  const shared = fromShareLink(RUNNING, 3, null);

  it('a cancel asked for shows the tab cancelling', () => {
    expect(cancelRequested(shared).status.cancelling).toBe(true);
  });

  it('a cancel that failed shows why, and the tab keeps executing', () => {
    const failed = cancelFailed("Couldn't cancel: down")(cancelRequested(shared));
    expect(failed.status).toMatchObject({
      executing: true,
      cancelling: false,
      error: { message: "Couldn't cancel: down" },
    });
  });

  it('resumed after a reload executes the tab', () => {
    const reloaded = { ...shared, status: { ...shared.status, executing: false } };
    expect(resumed(reloaded).status.executing).toBe(true);
  });

  it('stalled after a reload, with no run to follow, stops the tab executing', () => {
    expect(stalled(shared).status.executing).toBe(false);
  });

  it('the linked row once shown is cleared', () => {
    expect(linkedRowShown(shared).status.linkedRow).toBeNull();
  });
});

describe('Save…', () => {
  const RUN_KQL: CatalogueAction = {
    ...HOST_TIMELINE,
    key: 'tim.run_kql',
    name: 'Run KQL',
    params: [
      { name: 'kql', kind: 'string', required: true, many: false },
      { name: 'parameters', kind: 'json', required: false, many: false },
    ],
  };

  it("makes the tab the preset's: its id, its title template, and its name", () => {
    const tab = fromPivot({
      action: HOST_TIMELINE,
      params: { host: 'web01' },
      missing: {},
      pivotRows: [{ Host: 'web01' }],
      pivotRowIds: ['e1'],
    });
    const saved = savedAsPreset(MY_HOSTS, HOST_TIMELINE)(tab);
    expect(saved.title).toBe('My hosts');
    expect(saved.toRun).toEqual({
      ...tab.toRun,
      presetId: 'p-1',
      titleTemplate: 'My hosts: {host}',
    });
  });

  it('takes the query parameters the preset declares onto the tab, keeping the values it had', () => {
    const tab = fromAction(RUN_KQL, {
      kql: 'T | take 1',
      parameters: [{ name: 'Upn', type: 'string', value: 'alice' }],
    });
    const preset: Preset = {
      ...MY_HOSTS,
      action: 'tim.run_kql',
      inputs: [
        {
          name: 'Since',
          source: 'queryParameter',
          type: 'long',
          fixed: true,
          value: 7,
        },
        {
          name: 'Upn',
          source: 'queryParameter',
          type: 'string',
          fixed: false,
          fromColumns: [],
        },
      ],
    };
    expect(savedAsPreset(preset, RUN_KQL)(tab).toRun.params).toEqual({
      kql: 'T | take 1',
      parameters: [
        { name: 'Since', type: 'long', value: 7 },
        { name: 'Upn', type: 'string', value: 'alice' },
      ],
    });
  });
});

describe('the column view', () => {
  const tab = fromAction(HOST_TIMELINE, {});
  const HOST_FIRST: GridState = { columnOrder: { orderedColIds: ['Host', 'EventId'] } };
  const FILTERED: GridState = {
    ...HOST_FIRST,
    filter: { filterModel: { Host: { type: 'equals' } } },
  };

  it('picked is put on the tab, with the grid state as its baseline', () => {
    const picked = columnViewPicked({ viewId: 'v-1', name: 'Hosts' }, HOST_FIRST)(tab);
    expect(picked.grid).toEqual({
      gridState: HOST_FIRST,
      columnView: { viewId: 'v-1', name: 'Hosts', baseline: HOST_FIRST },
    });
  });

  it('a grid state change is kept, and the baseline stays', () => {
    const picked = columnViewPicked({ viewId: null, name: 'Built-in' }, HOST_FIRST)(tab);
    const changed = gridStateChanged(FILTERED)(picked);
    expect(changed.grid.gridState).toEqual(FILTERED);
    expect(changed.grid.columnView?.baseline).toEqual(HOST_FIRST);
  });

  it('renamed renames the tab’s when it is the one shown', () => {
    const picked = columnViewPicked({ viewId: 'v-1', name: 'Hosts' }, HOST_FIRST)(tab);
    expect(columnViewRenamed('v-1', 'Servers')(picked).grid.columnView?.name).toBe('Servers');
    expect(columnViewRenamed('v-2', 'Servers')(picked)).toEqual(picked);
  });
});
