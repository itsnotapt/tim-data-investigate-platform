import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { content } from '../../test/tabsTestUtils';
import { useTabsStore } from '../tabs/tabStore';
import { runRowsStore } from './runRows';

beforeEach(() => {
  useTabsStore.reset();
  runRowsStore.getState().clear();
});

describe('runRowsStore', () => {
  it('lets go of a tab’s rows when the tab is closed', async () => {
    const tabId = useTabsStore
      .getState()
      .createTab({ parentId: null, content: content('Sign-ins') });
    runRowsStore.getState().start(tabId, 'r1', null, 1);
    await useTabsStore.getState().removeTab(tabId);
    expect(runRowsStore.getState().byTab[tabId]).toBeUndefined();
  });
});
