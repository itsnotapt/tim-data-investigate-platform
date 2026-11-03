/**
 * The action tab module: what is inside a tab. Each transition takes a tab and returns it changed;
 * the tabs store applies them (`apply`). Each question answers from a tab alone.
 */
import type { GridState } from 'ag-grid-community';
import type { CatalogueAction, Preset, Run, RunRow } from '../../lib/api';
import type {
  ParamErrors,
  TabColumnView,
  TabContent,
  TabStatus,
  TabToRun,
  TitleInput,
} from '../../lib/storage';
import { presetTitleInputs } from '../presets/openPreset';
import type { Transition } from '../tabs';
import { isUnset, sameParams, stillMissing } from './paramValues';
import {
  pillValues,
  queryParameters,
  setPill,
  takesQueryParameters,
  withPresetQueryParameters,
} from './queryParameters';

/** A tab that has not run, titled `title`, to run `toRun`. */
const unrun = (title: string, toRun: TabToRun): TabContent => ({
  title,
  toRun,
  latest: { run: null, params: null, title: null },
  results: null,
  grid: { gridState: null, columnView: null },
  status: {
    executing: false,
    cancelling: false,
    error: null,
    paramErrors: null,
    linkedRow: null,
    pivotMissing: null,
  },
});

/** A tab of `action` from the New menu, with `params`, titled with the action's name. */
export const fromAction = (action: CatalogueAction, params: Record<string, unknown>): TabContent =>
  unrun(action.name, { action: action.key, params });

/** The params a tab opens with, and those it waits for, by name, each with the reason or `null`. */
export interface OpeningParams {
  params: Record<string, unknown>;
  missing: Record<string, string | null>;
}

/** The tab titled with `preset`'s name, holding its id and title inputs. */
const presetNamed =
  (preset: Preset): Transition =>
  (tab) => ({
    ...tab,
    title: preset.name,
    toRun: { ...tab.toRun, presetId: preset.presetId, titleInputs: presetTitleInputs(preset) },
  });

/** `tab` opened from `preset`: titled with its name, holding its id, title inputs and Id column. */
function ofPreset(tab: TabContent, preset: Preset): TabContent {
  const named = presetNamed(preset)(tab);
  return {
    ...named,
    grid: preset.idColumn ? { ...tab.grid, idColumn: preset.idColumn } : tab.grid,
  };
}

/** `tab` waiting for the params in `missing`, if any. */
const waitingFor = (tab: TabContent, missing: OpeningParams['missing']): TabContent =>
  Object.keys(missing).length > 0
    ? { ...tab, status: { ...tab.status, pivotMissing: missing } }
    : tab;

/** A tab of `preset` of `action` from the New menu, waiting for the params it left missing. */
export const fromPreset = (
  preset: Preset,
  action: CatalogueAction,
  { params, missing }: OpeningParams,
): TabContent => waitingFor(ofPreset(fromAction(action, params), preset), missing);

/** A pivot into an action or a preset of it: what its child tab opens with. */
export interface Pivot extends OpeningParams {
  action: CatalogueAction;
  preset?: Preset;
  /** The rows pivoted from, trimmed to the columns the action's title names. */
  pivotRows?: Record<string, unknown>[];
  /** The pivot rows' `id`s, each `null` for a row without one. */
  pivotRowIds: readonly (string | null)[];
}

/**
 * The child tab a pivot opens: of its preset when it has one, holding the pivot rows and their
 * `id`s, and waiting for the params the pivot left missing.
 */
export function fromPivot({
  action,
  preset,
  params,
  missing,
  pivotRows,
  pivotRowIds,
}: Pivot): TabContent {
  const tab = fromAction(action, params);
  const pivoted: TabContent = {
    ...tab,
    toRun: { ...tab.toRun, ...(pivotRows && { pivotRows }), pivotRowIds: [...pivotRowIds] },
  };
  return waitingFor(preset ? ofPreset(pivoted, preset) : pivoted, missing);
}

/**
 * A tab opened from a share link to `run`: it holds the run's action and params and follows the
 * run, focusing `linkedRow` when the link names a row, with the link's Id column when it names one.
 */
export function fromShareLink(
  run: Run,
  linkedRow: number | null,
  idColumn: string | null,
): TabContent {
  const tab = unrun(run.action.name, { action: run.action.key, params: run.params });
  return {
    ...tab,
    latest: { run, params: run.params, title: run.title },
    grid: idColumn !== null ? { ...tab.grid, idColumn } : tab.grid,
    status: { ...tab.status, executing: true, linkedRow },
  };
}

/** A deep copy of a plain JSON value. */
const copied = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * A copy of `tab` titled "Copy of <title>", with copies of its params, the rows it was pivoted from
 * and the inputs it shows in its title, and its Id column, not run. It is of no preset, so Save…
 * on it saves a new one.
 */
export function cloneOf(tab: TabContent): TabContent {
  const { action, params, pivotRows, titleInputs } = tab.toRun;
  const copy = unrun(`Copy of ${tab.title}`, {
    action,
    params: copied(params),
    ...(titleInputs && { titleInputs: copied(titleInputs) }),
    ...(pivotRows && { pivotRows: copied(pivotRows) }),
  });
  const { idColumn } = tab.grid;
  return idColumn !== undefined ? { ...copy, grid: { ...copy.grid, idColumn } } : copy;
}

/**
 * The pill `name` set to `value`. The pivot rows are dropped, so they stop titling the tab's runs,
 * and so is the reason the param was refused.
 */
export const paramEdited =
  (name: string, value: unknown): Transition =>
  (tab) => {
    const toRun = { ...tab.toRun };
    delete toRun.pivotRows;
    const paramErrors = tab.status.paramErrors && { ...tab.status.paramErrors };
    delete paramErrors?.[name];
    return {
      ...tab,
      toRun: { ...toRun, params: setPill(toRun.params, name, value) },
      status: { ...tab.status, paramErrors },
    };
  };

/**
 * The latest run's params and pivot rows put back, and the reasons params were refused cleared.
 */
export const paramsReset: Transition = (tab) => {
  const { params, pivotRows } = tab.latest;
  if (!params) return tab;
  const toRun = { ...tab.toRun, params };
  delete toRun.pivotRows;
  return {
    ...tab,
    toRun: pivotRows ? { ...toRun, pivotRows } : toRun,
    status: { ...tab.status, paramErrors: null },
  };
};

/** Whether the tab's params differ from its latest run's. */
export const isEdited = (tab: TabContent): boolean =>
  tab.latest.params !== null && !sameParams(tab.latest.params, tab.toRun.params);

/** The tab's Id column switched to `column`; `null` goes back to the action's. */
export const idColumnSwitched =
  (column: string | null): Transition =>
  (tab) => {
    const grid = { ...tab.grid };
    if (column === null) delete grid.idColumn;
    else grid.idColumn = column;
    return { ...tab, grid };
  };

/**
 * The Id column of the tab's results: its own (its preset's, or the one the analyst switched to),
 * else the action's, the `id` of its action file.
 */
export const idColumnOf = (tab: TabContent, action: CatalogueAction | undefined): string | null =>
  tab.grid.idColumn ?? action?.idColumn ?? null;

/** The Id column a share link to the tab's results carries: the tab's when it isn't the action's. */
export function linkIdColumnOf(
  tab: TabContent,
  action: CatalogueAction | undefined,
): string | null {
  const column = idColumnOf(tab, action);
  return column !== (action?.idColumn ?? null) ? column : null;
}

/** A value as a tab's title shows it: text as it is, anything else as JSON. */
const text = (value: unknown): string =>
  typeof value === 'string' ? value : JSON.stringify(value);

/** An input's value in a title: a list as up to two values, then how many more. */
function titleValue(value: unknown): string {
  if (!Array.isArray(value)) return text(value);
  const shown = value.slice(0, 2).map(text).join(', ');
  return value.length > 2 ? `${shown} +${value.length - 2}` : shown;
}

/** The value of `input` in `params`; a query parameter's is in the `parameters` param. */
const inputValue = (input: TitleInput, params: Record<string, unknown>): unknown =>
  input.source === 'param'
    ? params[input.name]
    : queryParameters(params.parameters).find((e) => e.name === input.name)?.value;

/**
 * The title a tab shows. Until it has run, its stored title. A preset tab's is its stored title,
 * the preset's name, then the values its latest run had for the inputs it shows in its title,
 * leaving out those unset. Any other tab's is its latest run's title.
 */
export function titleOf(tab: TabContent): string {
  const { titleInputs } = tab.toRun;
  const { params, title: runTitle } = tab.latest;
  if (titleInputs) {
    if (!params) return tab.title;
    const values = titleInputs.map((i) => inputValue(i, params)).filter((v) => !isUnset(v));
    return [tab.title, ...values.map(titleValue)].join(' ');
  }
  return runTitle ?? tab.title;
}

/**
 * The params the tab still needs: those a pivot or preset left missing that are still unset, by
 * pill name, in the order they were left missing.
 */
export const stillNeeded = (tab: TabContent): string[] =>
  stillMissing(tab.status.pivotMissing, pillValues(tab.toRun.params));

/** `tab` with `status` changed. */
const withStatus = (tab: TabContent, status: Partial<TabStatus>): TabContent => ({
  ...tab,
  status: { ...tab.status, ...status },
});

/**
 * A run of the tab asked for: the tab executes, with no error or linked row, and has no latest run
 * until the new one starts. The latest run's params and title stay.
 */
export const runStarting: Transition = (tab) => ({
  ...withStatus(tab, {
    executing: true,
    cancelling: false,
    error: null,
    paramErrors: null,
    linkedRow: null,
  }),
  latest: { ...tab.latest, run: null },
});

/** Why the server refused to start a run: the reasons of the params it shows, and any other. */
export interface Refusal {
  paramErrors: ParamErrors | null;
  message: string | null;
}

/**
 * The run asked for was refused. `before` is the tab as it was when the run was asked for: refused
 * params alone leave its latest run as it was.
 */
export const runRefused =
  ({ paramErrors, message }: Refusal, before: TabContent): Transition =>
  (tab) => ({
    ...withStatus(tab, {
      executing: false,
      error: message === null ? null : { message },
      paramErrors,
    }),
    latest: { ...tab.latest, run: message === null ? before.latest.run : null },
  });

/**
 * `run` started with `params`, sent with `pivotRows`: it is the tab's latest run, and the tab no
 * longer waits for the params a pivot left missing.
 */
export const runStarted =
  (run: Run, { params, pivotRows }: Pick<TabToRun, 'params' | 'pivotRows'>): Transition =>
  (tab) => ({
    ...withStatus(tab, { pivotMissing: null }),
    latest: { run, params, title: run.title, ...(pivotRows && { pivotRows }) },
  });

/** `run`, the tab's latest, has a new envelope. */
export const runUpdated =
  (run: Run): Transition =>
  (tab) => ({ ...tab, latest: { ...tab.latest, run } });

/**
 * `run` succeeded and its `rows` are stored: they are the tab's results, and the tab stops
 * executing. A linked row the rows don't have is dropped.
 */
export const runSucceeded =
  (run: Run, rows: readonly Pick<RunRow, 'row'>[]): Transition =>
  (tab) => {
    const { linkedRow } = tab.status;
    return {
      ...withStatus(tab, {
        executing: false,
        cancelling: false,
        error: null,
        linkedRow: rows.some((r) => r.row === linkedRow) ? linkedRow : null,
      }),
      results: {
        runId: run.runId,
        columns: run.columns ?? null,
        startedAt: run.startedAt,
        rowCount: rows.length,
      },
    };
  };

/** The tab's run ended without results: the tab stops executing and shows `message`. */
export const runFailed =
  (message: string): Transition =>
  (tab) =>
    withStatus(tab, { executing: false, cancelling: false, error: { message }, linkedRow: null });

/** A cancel of the tab's run was asked for; the tab shows it cancelling until the run ends. */
export const cancelRequested: Transition = (tab) => withStatus(tab, { cancelling: true });

/** The cancel asked for failed, with `message`; the run goes on. */
export const cancelFailed =
  (message: string): Transition =>
  (tab) =>
    withStatus(tab, { cancelling: false, error: { message } });

/** After a reload, the tab's run is followed again. */
export const resumed: Transition = (tab) => withStatus(tab, { executing: true });

/** After a reload, the tab was executing with no run to follow: it stops. */
export const stalled: Transition = (tab) => withStatus(tab, { executing: false });

/** The share link's row was shown. */
export const linkedRowShown: Transition = (tab) => withStatus(tab, { linkedRow: null });

/**
 * The tab was saved as `preset` of `action`: it holds the preset's id and the inputs its title
 * shows, is titled with its name, and takes the query parameters it declares.
 */
export const savedAsPreset =
  (preset: Preset, action: CatalogueAction | undefined): Transition =>
  (tab) => {
    const named = presetNamed(preset)(tab);
    return {
      ...named,
      toRun: {
        ...named.toRun,
        ...(action &&
          takesQueryParameters(action) && {
            params: withPresetQueryParameters(tab.toRun.params, preset.inputs ?? []),
          }),
      },
    };
  };

/** The column view `view` was put on the tab's grid, which then had `gridState`, its baseline. */
export const columnViewPicked =
  (view: Omit<TabColumnView, 'baseline'>, gridState: GridState): Transition =>
  (tab) => ({
    ...tab,
    grid: { ...tab.grid, gridState, columnView: { ...view, baseline: gridState } },
  });

/** The tab's grid state changed to `gridState`. */
export const gridStateChanged =
  (gridState: GridState): Transition =>
  (tab) => ({ ...tab, grid: { ...tab.grid, gridState } });

/** The column view `viewId` was renamed `name`. */
export const columnViewRenamed =
  (viewId: string, name: string): Transition =>
  (tab) => {
    const { columnView } = tab.grid;
    if (columnView?.viewId !== viewId) return tab;
    return { ...tab, grid: { ...tab.grid, columnView: { ...columnView, name } } };
  };
