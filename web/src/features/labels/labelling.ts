import type { Notify } from '../../components/notifyContext';
import type { AnnotationStore } from '../../lib/annotations';
import { changeAnnotations, type InstanceLabel } from '../../lib/api';
import { shownLabel } from './labels';
import type { LabelledRow } from './labelRows';

const count = (n: number) => n.toLocaleString('en-US');
const ids = (n: number) => `${count(n)} ${n === 1 ? 'id' : 'ids'}`;
/** Why a row without an `id` can't be annotated, and how to give it one. */
export const NO_ID = 'No id: right-click a cell and use its column as the Id column';
const reasonOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The distinct `id`s of `rows`; rows without one have nothing to annotate. */
export function targetIds(rows: readonly LabelledRow[]): string[] {
  return [...new Set(rows.flatMap((r) => (r.id ? [r.id] : [])))];
}

/** Why rows with `targets` can't be labelled now, else `null`. */
export function whyUnlabellable(targets: readonly string[], max: number): string | null {
  if (targets.length === 0) return NO_ID;
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
