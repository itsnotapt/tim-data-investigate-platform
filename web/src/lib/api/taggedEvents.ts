import { getApiClient, stripServerOwned, type CallOptions } from './client';
import type { components } from './schema';

export type SavedEvent = components['schemas']['SavedEvent'];
export type EventTag = components['schemas']['EventTag'];
export type EventComment = components['schemas']['EventComment'];

/** Server accepts 1 to 1000 items per request (Q-101). */
export const MAX_TAGGED_EVENTS_PER_REQUEST = 1000;

async function post(
  path: string,
  items: readonly object[],
  { client = getApiClient(), ...rest }: CallOptions,
): Promise<void> {
  if (items.length === 0) return;
  // createdBy / dateTimeUtc are set by the server from the token and its clock (SEC-03).
  for (let i = 0; i < items.length; i += MAX_TAGGED_EVENTS_PER_REQUEST) {
    await client.request({
      method: 'POST',
      path,
      body: stripServerOwned(items.slice(i, i + MAX_TAGGED_EVENTS_PER_REQUEST)),
      ...rest,
    });
  }
}

export const saveEvents = (events: readonly SavedEvent[], opts: CallOptions = {}) =>
  post('/api/taggedevents/savedEvents', events, opts);

export const tagEvents = (tags: readonly EventTag[], opts: CallOptions = {}) =>
  post('/api/taggedevents/tags', tags, opts);

export const commentEvents = (comments: readonly EventComment[], opts: CallOptions = {}) =>
  post('/api/taggedevents/comments', comments, opts);
