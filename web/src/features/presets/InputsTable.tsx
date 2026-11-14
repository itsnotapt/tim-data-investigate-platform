import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import TextField from '@mui/material/TextField';
import type { ReactNode } from 'react';
import { SourceSelect } from './SourceSelect';

/** One row of the inputs table: a param rows can fill, or a query parameter. */
export interface InputRow {
  key: string;
  /** The row's accessible name. */
  label: string;
  /** The Input cell: the name, or a field for it. */
  input: ReactNode;
  /** The Type cell: the type, or a field for it. */
  type: ReactNode;
  fixed: boolean;
  setFixed: (fixed: boolean) => void;
  /** Fixed: the value, or a field for it. */
  value: ReactNode;
  /** From row: the columns to read, in order. */
  columns: string[];
  /** The columns offered; when there are none, columns are typed. */
  columnOptions: readonly string[];
  setColumns: (columns: string[]) => void;
  /** After the value: the row's controls, if any. */
  controls?: ReactNode;
}

const COLUMNS = '150px 120px minmax(0, 1fr)';
const cell = { display: 'flex', alignItems: 'center', minWidth: 0, gap: 1 } as const;

/**
 * The columns of the clicked row an input reads, as chips: picked from its columns, or typed, each
 * trimmed and a blank one dropped.
 */
function ColumnsField({ row }: { row: InputRow }) {
  return (
    <Autocomplete
      multiple
      freeSolo={row.columnOptions.length === 0}
      autoSelect={row.columnOptions.length === 0}
      size="small"
      limitTags={2}
      options={row.columnOptions}
      value={row.columns}
      onChange={(_, columns) =>
        row.setColumns(columns.map((c) => c.trim()).filter((c) => c !== ''))
      }
      renderValue={(value, getItemProps) =>
        value.map((option, index) => {
          const { key, ...props } = getItemProps({ index });
          return <Chip key={key} size="small" label={option} {...props} />;
        })
      }
      renderInput={(input) => (
        <TextField
          {...input}
          placeholder={row.columns.length === 0 ? 'None: asked for when opened' : undefined}
          slotProps={{
            ...input.slotProps,
            htmlInput: { ...input.slotProps.htmlInput, 'aria-label': 'Columns' },
          }}
        />
      )}
      sx={{
        flex: 1,
        minWidth: 0,
        '& .MuiAutocomplete-inputRoot': { flexWrap: 'nowrap', overflow: 'hidden' },
      }}
    />
  );
}

/**
 * The inputs of a preset as a table (Input, Type, Value), every row the same height. The Value cell
 * holds the Fixed / From row dropdown, then the fixed value or the From row columns, then the
 * row's controls.
 */
export function InputsTable({ rows }: { rows: InputRow[] }) {
  return (
    <Box
      role="table"
      aria-label="Inputs"
      sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}
    >
      <Box
        role="row"
        sx={{
          display: 'grid',
          gridTemplateColumns: COLUMNS,
          columnGap: 1,
          px: 1.5,
          py: 0.75,
          bgcolor: 'action.hover',
          typography: 'caption',
          color: 'text.secondary',
          fontWeight: 600,
        }}
      >
        <span role="columnheader">Input</span>
        <span role="columnheader">Type</span>
        <span role="columnheader">Value</span>
      </Box>
      {rows.map((row) => (
        <Box
          key={row.key}
          role="row"
          aria-label={row.label}
          sx={{
            display: 'grid',
            gridTemplateColumns: COLUMNS,
            columnGap: 1,
            px: 1.5,
            height: 52,
            borderTop: 1,
            borderColor: 'divider',
          }}
        >
          <Box role="cell" sx={cell}>
            {row.input}
          </Box>
          <Box role="cell" sx={cell}>
            {row.type}
          </Box>
          <Box role="cell" sx={cell}>
            <SourceSelect fixed={row.fixed} onChange={row.setFixed} />
            {row.fixed ? row.value : <ColumnsField row={row} />}
            {row.controls}
          </Box>
        </Box>
      ))}
    </Box>
  );
}
