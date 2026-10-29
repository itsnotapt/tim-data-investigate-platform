import type { CustomStatusPanelProps } from 'ag-grid-react';
import type { ColumnViewController } from './useActionColumnView';
import { useTabColumnView } from './useTabColumnView';

/** AG Grid status panel "View: X • Edited"; the tab comes from `context.columnViews`. */
export function ColumnViewStatusPanel(props: CustomStatusPanelProps) {
  const { uuid } = (props.context as { columnViews: ColumnViewController }).columnViews;
  const { name, edited } = useTabColumnView(uuid);
  if (name === null) return null;
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
