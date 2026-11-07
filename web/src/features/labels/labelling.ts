import type { Notify } from '../../components/notifyContext';
import type { AnnotationStore } from '../../lib/annotations';
import { changeAnnotations, type InstanceLabel } from '../../lib/api';
import { shownLabel } from './labels';
import type { LabelledRow } from './labelRows';

const count = (n: number) => n.toLocaleString('en-US');
const ids = (n: number) => `${count(n)} ${n === 1 ? 'id' : 'ids'}`;

/** A column's duplicate ids, as the Id column pill and its editor say them. */
export const duplicatesFound = (n: number) =>
  `${count(n)} ${n === 1 ? 'duplicate' : 'duplicates'} found`;

/**
 * Why a row of Results under `idColumn` has no `id`: no Id column, an Id column with
 * `duplicates`, which gives no row an `id`, or else the row's value of it is empty.
 */
export function noIdReason(idColumn: string | null, duplicates: number): string {
  if (idColumn === null) return 'No id: no Id column';
  if (duplicates > 0) return `No id: ${duplicatesFound(duplicates)} in ${idColumn}`;
  return `No id: ${idColumn} is empty here`;
}
const reasonOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The distinct `id`s of `rows`; rows without one have nothing to annotate. */
export function targetIds(rows: readonly LabelledRow[]): string[] {
  return [...new Set(rows.flatMap((r) => (r.id ? [r.id] : [])))];
}

/**
 * Why rows with `targets` can't be labelled now, else `null`. `noId` is why a row has no `id`
 * ({@link noIdReason}).
 */
export function whyUnlabellable(
  targets: readonly string[],
  max: number,
  noId: string,
): string | null {
  if (targets.length === 0) return noId;
  if (targets.length > max) return `At most ${count(max)} ids; ${count(targets.length)} selected`;
  return null;
}

export interface LabellingDeps {
  store: AnnotationStore;
  labels: readonly InstanceLabel[];
  notify: Notify;
  /** Reads the change feed soon, so the other tabs pick the change up. */
  pollSoon: () => void;
}

/**
 * Sets the label of `targets` to `key`, or clears it with `null`, applies what changed and says
 * so in a toast. Never rejects.
 */
export async function setLabel(
  targets: readonly string[],
  key: string | null,
  { store, labels, notify, pollSoon }: LabellingDeps,
): Promise<void> {
  try {
    const { changes } = await changeAnnotations({ ids: [...targets], label: key });
    await store.apply(changes, 'own');
    pollSoon();
    const name = key === null ? null : shownLabel(key, labels).name;
    if (changes.length === 0) {
      notify(name === null ? 'No labels to clear' : `Already ${name}`);
      return;
    }
    notify(
      name === null
        ? `Cleared the label of ${ids(changes.length)}`
        : `Labelled ${ids(changes.length)} ${name}`,
    );
  } catch (e) {
    notify(`Couldn't label: ${reasonOf(e)}`);
  }
}
