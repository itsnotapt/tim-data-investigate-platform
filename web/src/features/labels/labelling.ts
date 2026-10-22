import type { Notify } from '../../components/notifyContext';
import type { AnnotationStore } from '../../lib/annotations';
import { changeAnnotations, type InstanceLabel } from '../../lib/api';
import { shownLabel } from './labels';
import type { LabelledRow } from './labelRows';

const count = (n: number) => n.toLocaleString('en-US');
const ids = (n: number) => `${count(n)} ${n === 1 ? 'id' : 'ids'}`;
const reasonOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The distinct `id`s of `rows`; rows without one have nothing to annotate. */
export function targetIds(rows: readonly LabelledRow[]): string[] {
  return [...new Set(rows.flatMap((r) => (r.id ? [r.id] : [])))];
}

/**
 * Why rows with `targets` can't be labelled now, else `null`. `idParam`: the action takes its rows'
 * id from an Id column param, as Run KQL does.
 */
export function whyUnlabellable(
  targets: readonly string[],
  max: number,
  idParam: boolean,
): string | null {
  if (targets.length === 0) {
    return idParam
      ? 'No id: set Id column and run again to annotate'
      : 'No id: this action gives its rows no id';
  }
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

/** Sends a label change, applies what changed, and returns it. */
async function send(
  targets: readonly string[],
  key: string | null,
  { store, pollSoon }: LabellingDeps,
): Promise<number> {
  const { changes } = await changeAnnotations(targets, key);
  await store.apply(changes, 'own');
  pollSoon();
  return changes.length;
}

/** Puts back each group of `id`s that shared a previous label, one `PATCH` per group. */
async function undo(groups: Map<string | null, string[]>, deps: LabellingDeps): Promise<void> {
  try {
    for (const [key, targets] of groups) await send(targets, key, deps);
  } catch (e) {
    deps.notify(`Couldn't undo: ${reasonOf(e)}`);
  }
}

/**
 * Sets the label of `targets` to `key`, or clears it with `null`, and says so in a toast with
 * Undo. Never rejects.
 */
export async function setLabel(
  targets: readonly string[],
  key: string | null,
  deps: LabellingDeps,
): Promise<void> {
  const { store, labels, notify } = deps;
  try {
    const before = await store.get(targets);
    const groups = new Map<string | null, string[]>();
    for (const id of targets) {
      const previous = before.get(id)?.label?.key ?? null;
      if (previous === key) continue;
      const group = groups.get(previous);
      if (group) group.push(id);
      else groups.set(previous, [id]);
    }
    const changed = await send(targets, key, deps);
    const name = key === null ? null : shownLabel(key, labels).name;
    if (changed === 0) {
      notify(name === null ? 'No labels to clear' : `Already ${name}`);
      return;
    }
    notify({
      message:
        name === null ? `Cleared the label of ${ids(changed)}` : `Labelled ${ids(changed)} ${name}`,
      action: { label: 'Undo', onClick: () => void undo(groups, deps) },
    });
  } catch (e) {
    notify(`Couldn't label: ${reasonOf(e)}`);
  }
}
