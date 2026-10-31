import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { annotated, createChannelHub } from '../../test/annotationFakes';
import { resetTimDb } from '../storage';
import { createAnnotationStore, type AnnotationsApplied } from './annotationStore';

beforeEach(async () => {
  await resetTimDb();
  globalThis.indexedDB = new IDBFactory();
});

afterEach(async () => {
  await resetTimDb();
});

/** Two tabs of one browser: one IndexedDB, one channel hub. */
function twoTabs() {
  const hub = createChannelHub();
  const tabs = [createAnnotationStore(hub.open()), createAnnotationStore(hub.open())] as const;
  const heard = tabs.map(() => [] as AnnotationsApplied[]);
  tabs.forEach((tab, i) => tab.subscribe((applied) => heard[i]!.push(applied)));
  return { tabs, heard };
}

describe('the annotation store', () => {
  it('keeps the newest version of each id and tells both tabs what changed', async () => {
    const {
      tabs: [a, b],
      heard,
    } = twoTabs();
    const applied = await a.apply([annotated('c-1', 2), annotated('c-2', 1)], 'own');
    expect(applied.map((x) => x.id)).toEqual(['c-1', 'c-2']);

    expect(await a.apply([annotated('c-1', 1, 'benign'), annotated('c-1', 2)], 'feed')).toEqual([]);
    await vi.waitFor(() => expect(heard[1]).toHaveLength(1));
    expect(heard[0]).toEqual([{ changes: applied, source: 'own' }]);
    expect(heard[1]).toEqual([{ changes: applied, source: 'own' }]);
    expect((await b.get(['c-1', 'c-2', 'c-3'])).get('c-1')).toEqual(annotated('c-1', 2));
  });

  it('keeps a cleared id as a tombstone that an older label cannot overwrite', async () => {
    const {
      tabs: [a],
    } = twoTabs();
    await a.apply([annotated('c-1', 1)], 'feed');
    await a.apply([annotated('c-1', 2, null)], 'feed');
    await a.apply([annotated('c-1', 1)], 'feed');
    expect([...(await a.get(['c-1'])).values()]).toEqual([annotated('c-1', 2, null)]);
  });

  it('within one change, the newest of an id wins', async () => {
    const {
      tabs: [a],
      heard,
    } = twoTabs();
    await a.apply([annotated('c-1', 3, 'benign'), annotated('c-1', 2)], 'feed');
    expect(heard[0]).toEqual([{ changes: [annotated('c-1', 3, 'benign')], source: 'feed' }]);
  });

  it('works without a channel', async () => {
    const store = createAnnotationStore(null);
    const heard: AnnotationsApplied[] = [];
    store.subscribe((applied) => heard.push(applied));
    await store.apply([annotated('c-1', 1)], 'own');
    expect(heard).toHaveLength(1);
  });
});
