import type { ComponentType } from 'react';
import { KustoQueryTab } from '../kusto-query/KustoQueryTab';
import { TemplateQueryTab } from '../template-query/TemplateQueryTab';
import type { TabKind } from './types';

/** Every tab component receives only its uuid and reads the tab from the store. */
export interface TabComponentProps {
  uuid: string;
}

export type TabRegistry = Record<TabKind, ComponentType<TabComponentProps>>;

/** tabType to component. Both tab kinds are real components. */
export const tabRegistry: TabRegistry = {
  KustoQueryResult: KustoQueryTab,
  TemplateQueryResult: TemplateQueryTab,
};

export function registerTabComponent(kind: TabKind, component: ComponentType<TabComponentProps>) {
  tabRegistry[kind] = component;
}
