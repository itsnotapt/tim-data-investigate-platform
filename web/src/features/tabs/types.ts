/**
 * A tab is a node of the investigation tree plus its content. The content belongs to the action
 * tab module (`features/action-tab/model.ts`); the tabs store only places, stores and removes tabs.
 * The shapes are shared with the IndexedDB layer (`src/lib/storage`).
 */
import type { Tab, TabContent } from '../../lib/storage';

export type { StoredError, Tab, TabContent } from '../../lib/storage';

/** A change to a tab's content. Pure: no store, React, MSW or IndexedDB. */
export type Transition = (tab: TabContent) => TabContent;

export interface CreateTabArgs {
  /** Generated when omitted. */
  id?: string;
  parentId: string | null;
  content: TabContent;
}

/** The fields the store owns: where the tab sits in the tree, its visited mark and row trigger. */
export type TabTreeFields = Pick<Tab, 'id' | 'parentId' | 'index' | 'visited' | 'rowDataTrigger'>;
