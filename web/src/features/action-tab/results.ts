import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { getAnnotationStore, type AnnotationsSource } from '../../lib/annotations';
import type { Annotations, RunColumn, RunRow } from '../../lib/api';
import { rowResultsDao, type TabResults } from '../../lib/storage';
import { gridRowId } from '../grid/columns';
import { indexRows, withIds, type LabelledRow, type RowsById } from '../labels';
import { useTabsStore } from '../tabs/tabStore';

/** A row of a tab's Results: the run's row, with its `id` and the `id`'s annotations. */
export type ResultRow = RunRow & LabelledRow;

/**
 * A tab's Results: the rows of its latest succeeded run, or of the run loading as its pages
 * arrive, each with its `id` under the tab's Id column and its annotations.
 */
export interface Results {
  runId: string;
  columns: RunColumn[] | null;
  /** The run's `rowCount`; the rows read back may be fewer, if the browser has lost some. */
  total: number;
  /** The rows so far, in order. */
  rows: readonly ResultRow[];
  /** Every row has arrived. */
  done: boolean;
  /** The Id column the rows' `id`s are under. */
  idColumn: string | null;
  /** The grid row ids of each `id`; kept up to date as rows are added. */
  rowsById: ReadonlyMap<string, readonly string[]>;
}

/** What changed in a tab's Results, for its grid to apply. */
export type ResultsChange =
  /** The rows are other rows, or none. */
  | { type: 'replaced' }
  /** Every row of the run has arrived. */
  | { type: 'loaded' }
  /** `rows` came after the rows there were. */
  | { type: 'added'; rows: readonly ResultRow[] }
  /**
   * `rows` have new annotations: those the browser has stored for their new `id`s, or a change
   * from the analyst or the feed.
   */
  | { type: 'annotated'; rows: readonly ResultRow[]; source: AnnotationsSource | 'stored' };

export type ResultsListener = (change: ResultsChange, results: Results | null) => void;

interface Entry {
  /** The holds on the Results: mounted grids. */
  holds: number;
  idColumn: string | null;
  /** The tab's last succeeded run, whose rows are in `row_results`. */
  stored: TabResults | null;
  /** Whether the tab has given its inputs; until it has, `idColumn` is the loading run's. */
  given: boolean;
  /** The run whose rows are loading. */
  loading: string | null;
  /** The run whose rows are being read from `row_results`. */
  reading: string | null;
  shown: Results | null;
  index: RowsById;
  /** The position in `shown.rows` of each grid row id. */
  positions: Map<string, number>;
  /** Stops hearing the annotation store. */
  unsubscribe: () => void;
}

const entries = new Map<string, Entry>();
const listeners = new Map<string, Set<ResultsListener>>();

function tell(tabId: string, change: ResultsChange): void {
  const results = resultsOf(tabId);
  for (const listener of listeners.get(tabId) ?? []) listener(change, results);
}

function entryOf(tabId: string): Entry {
  let entry = entries.get(tabId);
  if (!entry) {
    entry = {
      holds: 0,
      idColumn: null,
      stored: null,
      given: false,
      loading: null,
      reading: null,
      shown: null,
      index: new Map(),
      positions: new Map(),
      unsubscribe: getAnnotationStore().subscribe(({ changes, source }) =>
        annotate(tabId, changes, source),
      ),
    };
    entries.set(tabId, entry);
  }
  return entry;
}

/** Lets go of the tab's Results once nothing holds them and no run of it is loading. */
function letGoIfFree(tabId: string, entry: Entry): void {
  if (entry.holds > 0 || entry.loading !== null) return;
  letGo(tabId, entry);
}

function letGo(tabId: string, entry: Entry): void {
  entry.unsubscribe();
  if (entries.get(tabId) === entry) entries.delete(tabId);
}

/** The `id`s of `rows`, once each. */
const idsOf = (rows: readonly ResultRow[]) => [
  ...new Set(rows.flatMap((r) => (r.id ? [r.id] : []))),
];

/** Gives the rows of each changed `id` its annotations, where they are newer than the rows have. */
function annotate(
  tabId: string,
  changes: readonly Annotations[],
  source: AnnotationsSource | 'stored',
): void {
  const entry = entries.get(tabId);
  const shown = entry?.shown;
  if (!entry || !shown) return;
  let rows: ResultRow[] | null = null;
  const changed: ResultRow[] = [];
  for (const change of changes) {
    for (const gridId of entry.index.get(change.id) ?? []) {
      const at = entry.positions.get(gridId);
      const current = at === undefined ? undefined : (rows ?? shown.rows)[at];
      if (at === undefined || !current) continue;
      if ((current.annotations?.version ?? -1) >= change.version) continue;
      rows ??= [...shown.rows];
      rows[at] = { ...current, annotations: change };
      changed.push(rows[at]);
    }
  }
  if (!rows) return;
  entry.shown = { ...shown, rows };
  tell(tabId, { type: 'annotated', rows: changed, source });
}

/** Gives the rows of `ids` the annotations the browser has stored for them. */
function annotateStored(tabId: string, ids: readonly string[]): void {
  if (ids.length === 0) return;
  void getAnnotationStore()
    .get(ids)
    .then((found) => annotate(tabId, [...found.values()], 'stored'));
}

/** Shows `rows` of `run`, in place of the rows there were. */
function replace(
  tabId: string,
  entry: Entry,
  run: Omit<Results, 'rows' | 'idColumn' | 'rowsById'>,
  rows: readonly ResultRow[],
): void {
  entry.index = new Map();
  entry.positions = new Map();
  index(entry, rows, 0);
  entry.shown = { ...run, rows, idColumn: entry.idColumn, rowsById: entry.index };
  tell(tabId, { type: 'replaced' });
  annotateStored(tabId, idsOf(rows));
}

/** Reads the rows of the tab's last succeeded run, when there are no others to show. */
function readStored(tabId: string, entry: Entry): void {
  const { stored } = entry;
  if (!stored || entry.shown || entry.loading !== null || entry.reading === stored.runId) return;
  entry.reading = stored.runId;
  void rowResultsDao
    .get(tabId)
    .catch(() => [])
    .then((rows) => {
      if (entries.get(tabId) !== entry || entry.reading !== stored.runId) return;
      entry.reading = null;
      if (entry.shown || entry.loading !== null) return;
      const { runId, columns, rowCount } = stored;
      const read = withIds(rows as unknown as RunRow[], entry.idColumn);
      replace(tabId, entry, { runId, columns, total: rowCount, done: true }, read);
    });
}

/** Adds `rows` to the entry's index and positions, from position `from`. */
function index(entry: Entry, rows: readonly ResultRow[], from: number): void {
  indexRows(entry.index, rows);
  rows.forEach((r, i) => entry.positions.set(gridRowId(r), from + i));
}

/** The tab's Results, else `null`: none are held, or they are being read. */
export function resultsOf(tabId: string): Results | null {
  return entries.get(tabId)?.shown ?? null;
}

/** The rows of the tab's Results with these row numbers, in their order; those it hasn't are left out. */
export function resultRows(tabId: string, rowNumbers: readonly number[]): ResultRow[] {
  const entry = entries.get(tabId);
  const rows = entry?.shown?.rows;
  if (!entry || !rows) return [];
  return rowNumbers.flatMap((n) => {
    const at = entry.positions.get(gridRowId({ row: n }));
    const found = at === undefined ? undefined : rows[at];
    return found ? [found] : [];
  });
}

/** The row numbers of the rows of the tab's Results with `id`, in order. */
export function rowNumbersOf(tabId: string, id: string): number[] {
  return (entries.get(tabId)?.index.get(id) ?? []).map(Number);
}

/** Hears every change to the tab's Results. Returns the unsubscribe. */
export function subscribeResults(tabId: string, listener: ResultsListener): () => void {
  let set = listeners.get(tabId);
  if (!set) listeners.set(tabId, (set = new Set()));
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0 && listeners.get(tabId) === set) listeners.delete(tabId);
  };
}

/** What a tab's Results are given by the tab. */
export interface ResultsInputs {
  /** The tab's Id column. */
  idColumn: string | null;
  /** The tab's last succeeded run, whose rows are in `row_results`. */
  stored: TabResults | null;
}

/**
 * Keeps the tab's Results in memory until the returned release. They show once given their inputs
 * ({@link setResultsInputs}).
 */
export function holdResults(tabId: string): () => void {
  const entry = entryOf(tabId);
  entry.holds++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    entry.holds--;
    letGoIfFree(tabId, entry);
  };
}

/** Gives the tab's held Results their inputs, as the tab has them now. */
export function setResultsInputs(tabId: string, inputs: ResultsInputs): void {
  const entry = entries.get(tabId);
  if (!entry) return;
  entry.given = true;
  entry.stored = inputs.stored;
  if (inputs.idColumn !== entry.idColumn) {
    entry.idColumn = inputs.idColumn;
    const { shown } = entry;
    if (shown) replace(tabId, entry, shown, withIds(shown.rows, entry.idColumn));
  }
  readStored(tabId, entry);
}

/**
 * The rows of `run` start loading: they replace the tab's Results. `idColumn` is the tab's Id
 * column, for Results nothing holds yet.
 */
export function runLoading(
  tabId: string,
  run: { runId: string; columns: RunColumn[] | null; rowCount: number },
  idColumn: string | null,
): void {
  const entry = entryOf(tabId);
  if (!entry.given) entry.idColumn = idColumn;
  entry.loading = run.runId;
  entry.reading = null;
  const { runId, columns, rowCount } = run;
  replace(tabId, entry, { runId, columns, total: rowCount, done: false }, []);
}

/** A page of the loading run's rows arrived; ignored once another run has started loading. */
export function pageLoaded(tabId: string, runId: string, page: readonly RunRow[]): void {
  const entry = entries.get(tabId);
  const shown = entry?.shown;
  if (!entry || !shown || entry.loading !== runId || shown.runId !== runId) return;
  const added = withIds(page, entry.idColumn);
  index(entry, added, shown.rows.length);
  entry.shown = { ...shown, rows: [...shown.rows, ...added] };
  tell(tabId, { type: 'added', rows: added });
  annotateStored(tabId, idsOf(added));
}

/** Every row of the loading run has arrived and is stored in `row_results`. */
export function runLoaded(tabId: string, runId: string): void {
  const entry = entries.get(tabId);
  if (!entry?.shown || entry.loading !== runId) return;
  entry.loading = null;
  entry.shown = { ...entry.shown, done: true };
  tell(tabId, { type: 'loaded' });
  letGoIfFree(tabId, entry);
}

/**
 * The loading run's rows won't all arrive: the run failed, or was cancelled. Its rows go, and the
 * tab's Results are those of its last succeeded run again.
 */
export function loadAbandoned(tabId: string, runId: string): void {
  const entry = entries.get(tabId);
  if (!entry || entry.loading !== runId) return;
  entry.loading = null;
  entry.shown = null;
  entry.index = new Map();
  entry.positions = new Map();
  tell(tabId, { type: 'replaced' });
  readStored(tabId, entry);
  letGoIfFree(tabId, entry);
}

/**
 * The tab's Results, held while the component is mounted, given `inputs` as they change. `null`
 * while there are none, or while they are read from `row_results`.
 */
export function useResults(tabId: string, inputs: ResultsInputs): Results | null {
  const { idColumn, stored } = inputs;
  useEffect(() => holdResults(tabId), [tabId]);
  useEffect(() => setResultsInputs(tabId, { idColumn, stored }), [tabId, idColumn, stored]);
  const subscribe = useCallback(
    (onChange: () => void) => subscribeResults(tabId, onChange),
    [tabId],
  );
  return useSyncExternalStore(subscribe, () => resultsOf(tabId));
}

/** Lets go of every tab's Results. */
export function clearResults(): void {
  for (const [tabId, entry] of entries) letGo(tabId, entry);
}

// A closed tab's Results are let go.
useTabsStore.subscribe(({ tabs }) => {
  for (const [tabId, entry] of entries) if (!(tabId in tabs)) letGo(tabId, entry);
});
