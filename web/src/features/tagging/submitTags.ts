import { commentEvents, isApiError, saveEvents, tagEvents } from '../../lib/api';
import type { CallOptions } from '../../lib/api';
import type { TagRequests } from './tagDialogLogic';

export type TagStage = 'events' | 'comments' | 'tags';

/** A request failed; `stage` says which one (nothing after it was sent). */
export class TagSubmitError extends Error {
  readonly stage: TagStage;
  constructor(stage: TagStage, cause: unknown) {
    super(tagErrorMessage(cause), { cause });
    this.name = 'TagSubmitError';
    this.stage = stage;
  }
}

/** Server problem detail for API errors (legacy showed the 400 `title`), else the message. */
export function tagErrorMessage(err: unknown): string {
  if (isApiError(err)) return err.detail || err.title;
  return err instanceof Error ? err.message : String(err);
}

async function stage(name: TagStage, call: () => Promise<void>): Promise<void> {
  try {
    await call();
  } catch (err) {
    throw new TagSubmitError(name, err);
  }
}

/**
 * Sends saved events, then comments, then tags, sequentially (comments reference the saved
 * event, legacy order). Empty lists are skipped. Chunking at 1000 lives in the API client.
 * Throws `TagSubmitError`; `onStage` is called before each request that will be sent.
 */
export async function submitTagRequests(
  requests: Pick<TagRequests, 'savedEvents' | 'comments' | 'tags'>,
  opts: CallOptions & { onStage?: (stage: TagStage) => void } = {},
): Promise<void> {
  const { onStage, ...call } = opts;
  const steps: [TagStage, () => Promise<void>, number][] = [
    ['events', () => saveEvents(requests.savedEvents, call), requests.savedEvents.length],
    ['comments', () => commentEvents(requests.comments, call), requests.comments.length],
    ['tags', () => tagEvents(requests.tags, call), requests.tags.length],
  ];
  for (const [name, run, count] of steps) {
    if (count === 0) continue;
    onStage?.(name);
    await stage(name, run);
  }
}
