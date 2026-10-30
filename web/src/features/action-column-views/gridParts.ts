import type { SideBarDef, StatusPanelDef } from 'ag-grid-community';
import { SIDE_BAR } from '../grid';
import { ActionFileToolPanel } from './ActionFileToolPanel';
import { ColumnViewsToolPanel } from './ColumnViewsToolPanel';
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
      width: 320,
      minWidth: 280,
      toolPanel: ColumnViewsToolPanel,
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

/** An action tab's status bar panel "View: X • Edited". */
export const ACTION_STATUS_PANELS: StatusPanelDef[] = [
  { statusPanel: ColumnViewStatusPanel, align: 'left' },
];
