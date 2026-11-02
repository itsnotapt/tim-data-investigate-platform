import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import type { GridApi, IRowNode } from 'ag-grid-community';
import { useEffect, useMemo, useState } from 'react';
import type { LabelledRow } from '../labels';

export interface GoToPivotRowProps {
  /** The grid, once it is ready. */
  api: GridApi | null;
  /** The pivot rows' `id`s, each `null` for a row without one. */
  pivotRowIds: readonly (string | null)[];
}

/** The grid's rows against the pivot rows' `id`s. */
interface Matches {
  /** The grid's rows, filtered or not. */
  rows: number;
  /** The rows with a pivot row's `id`, filtered or not. */
  total: number;
  /** The rows with a pivot row's `id` that the filters let through, in grid order. */
  shown: IRowNode[];
}

const NO_MATCHES: Matches = { rows: 0, total: 0, shown: [] };

function findMatches(api: GridApi, ids: ReadonlySet<string>): Matches {
  const matches = (node: IRowNode) => {
    const id = (node.data as LabelledRow | undefined)?.id;
    return typeof id === 'string' && ids.has(id);
  };
  let rows = 0;
  let total = 0;
  api.forEachLeafNode((node) => {
    rows++;
    if (matches(node)) total++;
  });
  const shown: IRowNode[] = [];
  api.forEachNodeAfterFilterAndSort((node) => {
    if (!node.group && matches(node)) shown.push(node);
  });
  return { rows, total, shown };
}

/** Why there's no row to go to, else `null`. */
function reasonFor(ids: readonly (string | null)[], matches: Matches): string | null {
  if (ids.every((id) => id === null)) return 'The pivot rows have no id.';
  if (matches.total === 0) return "No row here has a pivot row's id.";
  if (matches.shown.length === 0) return "The pivot row is hidden by the grid's filters.";
  return null;
}

/** Whether `node`, or the closed group it is in, is above the grid's viewport. */
function isAbove(api: GridApi, node: IRowNode): boolean {
  let shown: IRowNode | null = node;
  while (shown && (shown.rowTop === null || !shown.displayed)) shown = shown.parent;
  if (!shown || shown.rowTop === null) return false;
  return shown.rowTop + (shown.rowHeight ?? 0) <= api.getVerticalPixelRange().top;
}

/** Expands `node`'s groups, scrolls it to the middle, focuses its first data cell and flashes it. */
function moveToRow(api: GridApi, node: IRowNode) {
  for (let group = node.parent; group && group.level >= 0; group = group.parent) {
    group.setExpanded(true, undefined, true);
  }
  api.ensureNodeVisible(node, 'middle');
  const column = api.getAllDisplayedColumns().find((c) => !c.getColId().startsWith('ag-Grid-'));
  if (node.rowIndex !== null && column) api.setFocusedCell(node.rowIndex, column);
  api.flashCells({ rowNodes: [node] });
}

/**
 * Go to pivot row: a pill floating over the bottom centre of an action tab's grid, above the
 * status bar. Each click goes to the next row, in grid order, whose `id` is a pivot row's, and
 * wraps after the last; the cycle starts over when the number of such rows changes. Its arrow
 * points to that row. With nowhere to go it is disabled, with the reason as its tooltip, and with
 * none until the grid has rows.
 */
export function GoToPivotRow({ api, pivotRowIds }: GoToPivotRowProps) {
  const ids = useMemo(
    () => new Set(pivotRowIds.filter((id): id is string => id !== null)),
    [pivotRowIds],
  );
  const [matches, setMatches] = useState(NO_MATCHES);
  // Bumped on a scroll, to point the arrow again.
  const [, setScrolled] = useState(0);
  useEffect(() => {
    if (!api || api.isDestroyed()) return;
    let frame = 0;
    const update = () => setMatches(findMatches(api, ids));
    const scrolled = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setScrolled((n) => n + 1));
    };
    update();
    api.addEventListener('modelUpdated', update);
    api.addEventListener('bodyScroll', scrolled);
    return () => {
      cancelAnimationFrame(frame);
      if (api.isDestroyed()) return;
      api.removeEventListener('modelUpdated', update);
      api.removeEventListener('bodyScroll', scrolled);
    };
  }, [api, ids]);
  const count = matches.shown.length;
  const [cursor, setCursor] = useState<{ count: number; at: number } | null>(null);
  const at = cursor?.count === count ? cursor.at : null;
  const nextAt = at === null ? 0 : (at + 1) % Math.max(count, 1);
  const next = matches.shown[nextAt];
  const reason = matches.rows === 0 ? null : reasonFor(pivotRowIds, matches);
  const onClick = () => {
    if (!api || !next) return;
    moveToRow(api, next);
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
              api && next && isAbove(api, next) ? <ArrowUpwardIcon /> : <ArrowDownwardIcon />
            }
            disabled={!next}
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
