import type { SideBarDef, StatusPanelDef } from 'ag-grid-community';
import { SIDE_BAR } from '../grid';
import { ActionFileToolPanel } from './ActionFileToolPanel';
import { ViewsPanelPrototype } from './ViewsPanel.prototype';
import { ColumnViewStatusPanel } from './ColumnViewStatusPanel';

/** An action tab's side bar: Columns, Filters, Views and Action file. */
export const ACTION_SIDE_BAR: SideBarDef = {
  toolPanels: [
    ...SIDE_BAR,
    {
      id: 'views',
      labelKey: 'views',
      labelDefault: 'Views',
      iconKey: 'eye',
      toolPanel: ViewsPanelPrototype, // PROTOTYPE: ColumnViewsToolPanel is variant `current`
    },
    {
      id: 'actionFile',
      labelKey: 'actionFile',
      labelDefault: 'Action file',
      iconKey: 'copy',
      toolPanel: ActionFileToolPanel,
    },
  ],
};

/** An action tab's status bar panel "View: X (applied) • modified". */
export const ACTION_STATUS_PANELS: StatusPanelDef[] = [
  { statusPanel: ColumnViewStatusPanel, align: 'left' },
];
