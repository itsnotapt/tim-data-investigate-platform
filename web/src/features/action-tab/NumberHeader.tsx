import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import Tooltip from '@mui/material/Tooltip';
import type { CustomInnerHeaderProps } from 'ag-grid-react';
import { useContext } from 'react';
import { RoundedColumnsContext } from './roundedColumns';

const ROUNDED =
  'Whole numbers beyond ±(2^53 − 1) are shown rounded. Declare the column as bigint to keep them exact.';

/** A `number` column's header text, with a warning when the column holds rounded whole numbers. */
export function NumberHeader({ displayName, column }: CustomInnerHeaderProps) {
  const rounded = useContext(RoundedColumnsContext).has(column.getColId());
  return (
    <>
      <span className="ag-header-cell-text">{displayName}</span>
      {rounded && (
        <Tooltip title={ROUNDED}>
          <WarningAmberIcon color="warning" fontSize="inherit" sx={{ ml: 0.5, flexShrink: 0 }} />
        </Tooltip>
      )}
    </>
  );
}
