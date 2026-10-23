import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { annotated, createChannelHub, createFakeLocks } from '../../test/annotationFakes';
import type { AnnotationChangesPage } from '../api';
import { resetTimDb } from '../storage';
import { createAnnotationStore, type AnnotationsApplied } from './annotationStore';
import { startAnnotationPoller, type AnnotationPoller } from './poller';

beforeEach(async () => {
  await resetTimDb();
  globalThis.indexedDB = new IDBFactory();
});

const running: AnnotationPoller[] = [];
afterEach(async () => {
  for (const poller of running.splice(0)) poller.stop();
  await resetTimDb();
});

const page = (changes: AnnotationChangesPage['changes'], next: number, hasMore = false) => ({
  changes,
  next,
  hasMore,
});

/** One browser: `count` tabs sharing IndexedDB, a channel hub and the locks. */
function browser(count: number, intervalMs = 60_000) {
  const hub = createChannelHub();
  const locks = createFakeLocks();
  const focus = new EventTarget();
  const feed = vi.fn((since: number) => Promise.resolve(page([], since)));
  const tabs = Array.from({ length: count }, () => {
    const store = createAnnotationStore(hub.open());
    const heard: AnnotationsApplied[] = [];
    store.subscribe((applied) => heard.push(applied));
    const fetchChanges = vi.fn((since: number) => feed(since));
    const poller = startAnnotationPoller({ store, locks, intervalMs, fetchChanges, focus });
    running.push(poller);
    return { store, heard, fetchChanges, poller };
  });
  return { tabs, feed, focus };
}

describe('the annotation poller', () => {
  it('polls in one tab only, for every tab', async () => {
    const { tabs, feed } = browser(3);
    const [leader, ...others] = tabs;
    await vi.waitFor(() => expect(leader!.fetchChanges).toHaveBeenCalledTimes(1));

    feed.mockResolvedValueOnce(page([annotated('c-1', 1)], 1));
    others[1]!.poller.pollSoon();
    await vi.waitFor(() => expect(leader!.fetchChanges).toHaveBeenCalledTimes(2));
    for (const tab of tabs) {
      await vi.waitFor(() =>
        expect(tab.heard).toEqual([{ changes: [annotated('c-1', 1)], source: 'feed' }]),
      );
    }
    for (const tab of others) expect(tab.fetchChanges).not.toHaveBeenCalled();
  });

  it('reads every page and carries on from the cursor', async () => {
    const { tabs, feed } = browser(1);
    const [tab] = tabs;
    await vi.waitFor(() => expect(feed).toHaveBeenCalledWith(0));

    feed
      .mockResolvedValueOnce(page([annotated('a', 3)], 3, true))
      .mockResolvedValueOnce(page([annotated('b', 4)], 4));
    tab!.poller.pollSoon();
    await vi.waitFor(() => expect(feed).toHaveBeenLastCalledWith(3));
    tab!.poller.pollSoon();
    await vi.waitFor(() => expect(feed).toHaveBeenLastCalledWith(4));
    expect([...(await tab!.store.get(['a', 'b'])).keys()]).toEqual(['a', 'b']);
  });

  it('polls on focus and every interval', async () => {
    const { feed, focus } = browser(1, 20);
    await vi.waitFor(() => expect(feed.mock.calls.length).toBeGreaterThanOrEqual(3));
    const before = feed.mock.calls.length;
    focus.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(feed.mock.calls.length).toBeGreaterThan(before));
  });

  it('hands polling to another tab when its tab closes', async () => {
    const { tabs } = browser(2);
    const [first, second] = tabs;
    await vi.waitFor(() => expect(first!.fetchChanges).toHaveBeenCalled());
    first!.poller.stop();
    await vi.waitFor(() => expect(second!.fetchChanges).toHaveBeenCalled());
  });

  it('tries again at the next poll after a failure', async () => {
    const { tabs, feed } = browser(1);
    await vi.waitFor(() => expect(feed).toHaveBeenCalledTimes(1));
    feed.mockRejectedValueOnce(new Error('offline'));
    tabs[0]!.poller.pollSoon();
    await vi.waitFor(() => expect(feed).toHaveBeenCalledTimes(2));
    feed.mockResolvedValueOnce(page([annotated('a', 1)], 1));
    tabs[0]!.poller.pollSoon();
    await vi.waitFor(() => expect(tabs[0]!.heard).toHaveLength(1));
  });
});
