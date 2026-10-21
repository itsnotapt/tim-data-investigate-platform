import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { useTabsStore } from '../tabs/tabStore';
import { runRowsStore } from './runRows';

beforeEach(() => {
  useTabsStore.reset();
  runRowsStore.getState().clear();
});

describe('runRowsStore', () => {
  it('lets go of a tab’s rows when the tab is closed', async () => {
    const uuid = useTabsStore.getState().createTab({
      componentName: 'ActionResult',
      parentUuid: null,
      title: 'Sign-ins',
      params: { action: 'dev-sign-ins', params: {} },
    });
    runRowsStore.getState().start(uuid, 'r1', null, 1);
    await useTabsStore.getState().removeTab(uuid);
    expect(runRowsStore.getState().byTab[uuid]).toBeUndefined();
  });
});
