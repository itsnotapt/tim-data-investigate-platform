import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Checkbox from '@mui/material/Checkbox';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Tooltip from '@mui/material/Tooltip';
import type { CustomStatusPanelProps } from 'ag-grid-react';
import { useEffect, useMemo, useState } from 'react';
import { gridView, type GridView } from './gridView';
import { usePivotRowHighlight, usePivotRows, type PivotRows } from './pivotRows';
import { rowNumbersOf } from './results';

/** The grid's rows against the pivot rows' `id`s. */
interface Matches {
  /** The grid's rows, filtered or not. */
  rows: number;
  /** The rows with a pivot row's `id`, filtered or not. */
  total: number;
  /** The row numbers of the rows with a pivot row's `id` that the filters let through, in grid order. */
  shown: number[];
}

const NO_MATCHES: Matches = { rows: 0, total: 0, shown: [] };

function findMatches(tabId: string, grid: GridView, ids: ReadonlySet<string>): Matches {
  const matching = new Set([...ids].flatMap((id) => rowNumbersOf(tabId, id)));
  return { rows: grid.rowCount(), total: matching.size, shown: grid.shownAmong(matching) };
}

/** Why there's no row to go to, else `null`. */
function reasonFor(ids: readonly (string | null)[], matches: Matches): string | null {
  if (ids.every((id) => id === null)) return 'The pivot rows have no id.';
  if (matches.total === 0) return "No row here has a pivot row's id.";
  if (matches.shown.length === 0) return "The pivot row is hidden by the grid's filters.";
  return null;
}

/**
 * AG Grid status panel of the pivot rows the grid of the tab `context.tabId` shows: none, or Go to
 * pivot row. Each click goes to the next row, in grid order, whose `id`
 * is a pivot row's, and wraps after the last; the cycle starts over when the number of such rows
 * changes. With more than one, it numbers the row the next click goes to, and its arrow points to
 * that row. With nowhere to go it is disabled, with the reason as its tooltip, and with none until
 * the grid has rows. Then Highlight pivot rows, which tints every such row while it is ticked: it is
 * ticked when the tab opens, and disabled while no row has a pivot row's `id`.
 */
export function PivotRowsStatusPanel({ context, api }: CustomStatusPanelProps) {
  // The context is the one the grid started with, so it gives only the tab.
  const { tabId } = context as { tabId: string };
  const pivotRows = usePivotRows(tabId);
  const grid = useMemo(() => gridView(api), [api]);
  if (!pivotRows) return null;
  return <PivotRowControls tabId={tabId} pivotRows={pivotRows} grid={grid} />;
}

/** Go to pivot row and Highlight pivot rows, for the pivot rows of the tab's grid. */
function PivotRowControls({
  tabId,
  pivotRows: { rowIds, ids },
  grid,
}: {
  tabId: string;
  pivotRows: PivotRows;
  grid: GridView;
}) {
  const [matches, setMatches] = useState(NO_MATCHES);
  // Bumped on a scroll, to point the arrow again.
  const [, setScrolled] = useState(0);
  useEffect(() => {
    if (grid.isDestroyed()) return;
    let frame = 0;
    const update = () => setMatches(findMatches(tabId, grid, ids));
    const scrolled = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setScrolled((n) => n + 1));
    };
    update();
    const stopShown = grid.onShownChange(update);
    const stopScroll = grid.onScroll(scrolled);
    return () => {
      cancelAnimationFrame(frame);
      stopShown();
      stopScroll();
    };
  }, [tabId, grid, ids]);
  const count = matches.shown.length;
  const [cursor, setCursor] = useState<{ count: number; at: number } | null>(null);
  const at = cursor?.count === count ? cursor.at : null;
  const nextAt = at === null ? 0 : (at + 1) % Math.max(count, 1);
  const next = matches.shown[nextAt];
  const reason = matches.rows === 0 ? null : reasonFor(rowIds, matches);
  const onClick = () => {
    if (next === undefined) return;
    // Focuses its first data cell, opening its groups, and flashes it.
    grid.goTo(next);
    grid.flash(next);
    setCursor({ count, at: nextAt });
  };
  const [highlight, setHighlight] = usePivotRowHighlight(tabId);
  const Arrow = next !== undefined && grid.isAbove(next) ? ArrowUpwardIcon : ArrowDownwardIcon;
  return (
    <Box
      className="ag-status-name-value ag-status-panel"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        color: 'text.secondary',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      <Tooltip title={reason ?? ''}>
        <span>
          <ButtonBase
            disabled={next === undefined}
            onClick={onClick}
            sx={{
              gap: 0.5,
              px: 0.75,
              borderRadius: 1,
              fontSize: 'inherit',
              color: 'inherit',
              '&:hover': { color: 'primary.main', textDecoration: 'underline' },
              '&.Mui-disabled': { opacity: 0.5 },
            }}
          >
            <Arrow sx={{ fontSize: 14 }} />
            Go to pivot row{count > 1 && ` (${nextAt + 1} of ${count})`}
          </ButtonBase>
        </span>
      </Tooltip>
      <Divider orientation="vertical" flexItem sx={{ my: 0.25 }} />
      <FormControlLabel
        disabled={matches.total === 0}
        control={
          <Checkbox
            size="small"
            checked={highlight}
            onChange={(e) => setHighlight(e.target.checked)}
            sx={{ p: 0, '& svg': { fontSize: 16 } }}
          />
        }
        label="Highlight pivot rows"
        sx={{
          m: 0,
          gap: 0.5,
          color: 'inherit',
          '& .MuiFormControlLabel-label': { fontSize: 'inherit' },
        }}
      />
    </Box>
  );
}
