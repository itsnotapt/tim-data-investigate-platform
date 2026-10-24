import type { SideBarDef, StatusPanelDef } from 'ag-grid-community';
import { SIDE_BAR } from '../grid';
import { ColumnViewsToolPanel } from './ColumnViewsToolPanel';
import { ColumnViewStatusPanel } from './ColumnViewStatusPanel';

/** An action tab's side bar: Columns, Filters and Views. */
export const ACTION_SIDE_BAR: SideBarDef = {
  toolPanels: [
    ...SIDE_BAR,
    {
      id: 'views',
      labelKey: 'views',
      labelDefault: 'Views',
      iconKey: 'eye',
      toolPanel: ColumnViewsToolPanel,
    },
  ],
};

/** An action tab's status bar panel "View: X (applied) • modified". */
export const ACTION_STATUS_PANELS: StatusPanelDef[] = [
  { statusPanel: ColumnViewStatusPanel, align: 'left' },
];
