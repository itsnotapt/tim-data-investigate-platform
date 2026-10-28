import type { Notify } from '../../components/notifyContext';
import type { AnnotationStore } from '../../lib/annotations';
import { changeAnnotations } from '../../lib/api';

const reasonOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface CommentingDeps {
  store: AnnotationStore;
  notify: Notify;
  /** Reads the change feed soon, so the other tabs pick the change up. */
  pollSoon: () => void;
}

/**
 * Sets the analyst's comment on `id` to `text`, or clears it when `text` is empty, and applies what
 * changed. A failure is said in a toast, and changes nothing. Never rejects.
 */
export async function saveComment(
  id: string,
  text: string,
  { store, notify, pollSoon }: CommentingDeps,
): Promise<void> {
  try {
    const { changes } = await changeAnnotations({ ids: [id], comment: text === '' ? null : text });
    await store.apply(changes, 'own');
    pollSoon();
  } catch (e) {
    notify(`Couldn't save the comment: ${reasonOf(e)}`);
  }
}
