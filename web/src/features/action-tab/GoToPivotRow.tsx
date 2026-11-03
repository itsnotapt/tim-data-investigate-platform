import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import { useEffect, useMemo, useState } from 'react';
import type { GridView } from './gridView';
import { rowNumbersOf } from './results';

export interface GoToPivotRowProps {
  /** The tab whose grid it goes through. */
  tabId: string;
  /** The tab's grid, once it is ready. */
  grid: GridView | null;
  /** The pivot rows' `id`s, each `null` for a row without one. */
  pivotRowIds: readonly (string | null)[];
}

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
 * Go to pivot row: a pill floating over the bottom centre of an action tab's grid, above the
 * status bar. Each click goes to the next row, in grid order, whose `id` is a pivot row's, and
 * wraps after the last; the cycle starts over when the number of such rows changes. Its arrow
 * points to that row. With nowhere to go it is disabled, with the reason as its tooltip, and with
 * none until the grid has rows.
 */
export function GoToPivotRow({ tabId, grid, pivotRowIds }: GoToPivotRowProps) {
  const ids = useMemo(
    () => new Set(pivotRowIds.filter((id): id is string => id !== null)),
    [pivotRowIds],
  );
  const [matches, setMatches] = useState(NO_MATCHES);
  // Bumped on a scroll, to point the arrow again.
  const [, setScrolled] = useState(0);
  useEffect(() => {
    if (!grid || grid.isDestroyed()) return;
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
  const reason = matches.rows === 0 ? null : reasonFor(pivotRowIds, matches);
  const onClick = () => {
    if (!grid || next === undefined) return;
    // Focuses its first data cell, opening its groups, and flashes it.
    grid.goTo(next);
    grid.flash(next);
    setCursor({ count, at: nextAt });
  };
  const label = `Go to pivot row${count > 1 && at !== null ? ` (${at + 1} of ${count})` : ''}`;
  return (
    <Box
      sx={{
        position: 'absolute',
        bottom: 56,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 3,
      }}
    >
      <Tooltip title={reason ?? ''}>
        <span>
          <Button
            variant="contained"
            size="small"
            startIcon={
              grid && next !== undefined && grid.isAbove(next) ? (
                <ArrowUpwardIcon />
              ) : (
                <ArrowDownwardIcon />
              )
            }
            disabled={next === undefined}
            onClick={onClick}
            sx={{
              borderRadius: 999,
              boxShadow: 4,
              textTransform: 'none',
              px: 2,
              '&.Mui-disabled': { bgcolor: 'background.paper', color: 'text.secondary' },
            }}
          >
            {label}
          </Button>
        </span>
      </Tooltip>
    </Box>
  );
}
