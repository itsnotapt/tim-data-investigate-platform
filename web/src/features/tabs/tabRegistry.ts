import type { ComponentType } from 'react';
import { ActionTab } from '../action-tab/ActionTab';
import { KustoQueryTab } from '../kusto-query/KustoQueryTab';
import type { TabKind } from './types';

/** Every tab component receives only its uuid and reads the tab from the store. */
export interface TabComponentProps {
  uuid: string;
}

export type TabRegistry = Record<TabKind, ComponentType<TabComponentProps>>;

/** tabType to component. */
export const tabRegistry: TabRegistry = {
  ActionResult: ActionTab,
  KustoQueryResult: KustoQueryTab,
};
