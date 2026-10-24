import type { CustomStatusPanelProps } from 'ag-grid-react';
import type { ColumnViewController } from './useActionColumnView';
import { useTabColumnView } from './useTabColumnView';

/** AG Grid status panel "View: X (applied) • modified"; the tab comes from `context.columnViews`. */
export function ColumnViewStatusPanel(props: CustomStatusPanelProps) {
  const { uuid } = (props.context as { columnViews: ColumnViewController }).columnViews;
  const { columnView, applied, modified } = useTabColumnView(uuid);
  if (!columnView) return null;
  return (
    <div data-testid="column-view-status" className="ag-status-name-value ag-status-panel">
      <span>View:</span>
      <span className="ag-status-name-value-value" style={{ paddingLeft: 4 }}>
        {columnView.name}
        {applied && ' (applied)'}
        {modified && ' • modified'}
      </span>
    </div>
  );
}
