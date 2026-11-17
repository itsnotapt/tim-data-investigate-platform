import type { CustomStatusPanelProps } from 'ag-grid-react';
import type { ColumnViewController } from './useActionColumnView';
import { useTabColumnView } from './useTabColumnView';

/** AG Grid status panel "View: X • Edited"; the tab comes from `context.columnViews`. */
export function ColumnViewStatusPanel(props: CustomStatusPanelProps) {
  const { tabId } = (props.context as { columnViews: ColumnViewController }).columnViews;
  const { name, edited } = useTabColumnView(tabId);
  // Never null: AG Grid leaves out a React status panel that renders no element within a second,
  // and the tab's column view can take longer than that to be put on the grid.
  if (name === null) return <span hidden />;
  return (
    <div data-testid="column-view-status" className="ag-status-name-value ag-status-panel">
      <span>View:</span>
      <span className="ag-status-name-value-value" style={{ paddingLeft: 4 }}>
        {name}
        {edited && ' • Edited'}
      </span>
    </div>
  );
}
