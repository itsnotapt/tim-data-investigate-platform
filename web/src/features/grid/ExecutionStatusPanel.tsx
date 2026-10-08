import type { CustomStatusPanelProps } from 'ag-grid-react';
import { formatExecutionStats, useStats } from './status';
import type { ExecutionStats, StatsStore } from './status';

/** Presentational part: reuses AG Grid's status-bar classes so it looks like the built-in panels. */
export function ExecutionStatusView({ stats }: { stats: ExecutionStats }) {
  return (
    <div data-testid="execution-status">
      {formatExecutionStats(stats).map((item) => (
        <div key={item.label} className="ag-status-name-value ag-status-panel">
          <span>{item.label}:</span>
          <span className="ag-status-name-value-value" style={{ paddingLeft: 4 }}>
            {item.value}
          </span>
        </div>
      ))}
    </div>
  );
}

/** AG Grid status panel; reads the stats store from grid `context.statsStore`. */
export function ExecutionStatusPanel(props: CustomStatusPanelProps) {
  const store = (props.context as { statsStore?: StatsStore } | undefined)?.statsStore;
  return <ExecutionStatusView stats={useStats(store)} />;
}
