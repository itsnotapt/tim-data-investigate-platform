/**
 * PROTOTYPE #249, throwaway: Go to pivot row, a link floating over the bottom of a pivoted tab's
 * grid, in two variants on the existing `/view/:uuid` route, switchable with `?variant=`:
 *
 * - `A`: disabled when there's nowhere to go, with the reason as its tooltip.
 * - `B`: always enabled; a click with nowhere to go says the reason in a toast.
 *
 * `?hide=1` hides the link while every matching row is on screen, as a chat app's Jump to latest.
 * `?scenario=noid|nomatch` fakes the empty states. Only tabs pivoted after this loaded have pivot
 * rows. Not for main: see the branch `chore/249-go-to-pivot-row-prototype`.
 */
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import type { GridApi, IRowNode } from 'ag-grid-community';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useSearchParams } from 'react-router';
import { useNotify } from '../../components/useNotify';

const VARIANTS = [
  { key: 'A', name: 'Disabled, reason as tooltip' },
  { key: 'B', name: 'Always enabled, reason as toast' },
] as const;
const SCENARIOS = ['real', 'noid', 'nomatch'] as const;

interface Matches {
  /** Matching rows the filters let through, in grid order. */
  visible: IRowNode[];
  /** Matching rows, filtered or not. */
  total: number;
}

function findMatches(api: GridApi, ids: ReadonlySet<string>): Matches {
  const has = (n: IRowNode) => {
    const id = (n.data as { id?: string | null } | undefined)?.id;
    return typeof id === 'string' && ids.has(id);
  };
  let total = 0;
  api.forEachLeafNode((n) => {
    if (has(n)) total++;
  });
  const visible: IRowNode[] = [];
  api.forEachNodeAfterFilterAndSort((n) => {
    if (!n.group && has(n)) visible.push(n);
  });
  return { visible, total };
}

function reasonFor(ids: readonly (string | null)[], m: Matches): string | null {
  if (ids.every((id) => id === null)) return 'The pivot rows have no id.';
  if (m.total === 0) return "No row here has a pivot row's id.";
  if (m.visible.length === 0) return "The pivot row is hidden by the grid's filters.";
  return null;
}

/** Where `node` is against the viewport: above it, on it or below it. */
function placeOf(api: GridApi, node: IRowNode): 'above' | 'on' | 'below' {
  let shown: IRowNode | null = node;
  while (shown && (shown.rowTop === null || !shown.displayed)) shown = shown.parent;
  const { top, bottom } = api.getVerticalPixelRange();
  if (!shown || shown.rowTop === null) return 'below';
  if (shown.rowTop + (shown.rowHeight ?? 0) <= top) return 'above';
  if (shown.rowTop >= bottom) return 'below';
  return shown === node ? 'on' : 'below';
}

function goTo(api: GridApi, node: IRowNode) {
  for (let group = node.parent; group && group.level >= 0; group = group.parent) {
    group.setExpanded(true, undefined, true);
  }
  api.ensureNodeVisible(node, 'middle');
  const column = api.getAllDisplayedColumns().find((c) => !c.getColId().startsWith('ag-Grid-'));
  if (node.rowIndex !== null && column) api.setFocusedCell(node.rowIndex, column);
}

export function GoToPivotRowPrototype({
  uuid,
  api,
  pivotRowIds,
}: {
  /** The tab: only the tab on screen shows the switcher. */
  uuid: string;
  api: GridApi | null;
  pivotRowIds: readonly (string | null)[];
}) {
  const [search] = useSearchParams();
  const onScreen = useParams()['uuid'] === uuid;
  const variant = search.get('variant') === 'B' ? 'B' : 'A';
  const hide = search.get('hide') === '1';
  const scenario = search.get('scenario') ?? 'real';
  const notify = useNotify();
  const ids = useMemo(
    () =>
      scenario === 'noid'
        ? pivotRowIds.map(() => null)
        : scenario === 'nomatch'
          ? ['prototype-no-such-id']
          : [...pivotRowIds],
    [pivotRowIds, scenario],
  );
  const idSet = useMemo(() => new Set(ids.filter((id): id is string => id !== null)), [ids]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!api || api.isDestroyed()) return;
    let frame = 0;
    const bump = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setTick((t) => t + 1));
    };
    api.addEventListener('modelUpdated', bump);
    api.addEventListener('bodyScroll', bump);
    bump();
    return () => {
      cancelAnimationFrame(frame);
      if (api.isDestroyed()) return;
      api.removeEventListener('modelUpdated', bump);
      api.removeEventListener('bodyScroll', bump);
    };
  }, [api]);
  const matches = useMemo<Matches>(
    () => (api && !api.isDestroyed() ? findMatches(api, idSet) : { visible: [], total: 0 }),
    // `tick` recomputes on model updates and scrolls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, idSet, tick],
  );
  const count = matches.visible.length;
  // The cursor starts over when the number of matches changes.
  const [cursor, setCursor] = useState<{ count: number; at: number } | null>(null);
  const at = cursor?.count === count ? cursor.at : null;
  const reason = reasonFor(ids, matches);
  const next = count > 0 ? matches.visible[at === null ? 0 : (at + 1) % count] : undefined;
  const places = api ? matches.visible.map((n) => placeOf(api, n)) : [];
  const allOnScreen = count > 0 && places.every((p) => p === 'on');
  const nextPlace = api && next ? placeOf(api, next) : 'below';

  const onClick = useCallback(() => {
    if (reason) {
      notify(reason);
      return;
    }
    if (!api || !next) return;
    goTo(api, next);
    setCursor({ count, at: at === null ? 0 : (at + 1) % count });
  }, [reason, notify, api, next, at, count]);

  const hidden = !api || (hide && !reason && allOnScreen);
  const label = `Go to pivot row${count > 1 && at !== null ? ` (${at + 1} of ${count})` : ''}`;
  const icon = nextPlace === 'above' ? <ArrowUpwardIcon /> : <ArrowDownwardIcon />;
  const button = (
    <Button
      variant="contained"
      size="small"
      startIcon={icon}
      disabled={variant === 'A' && reason !== null}
      onClick={onClick}
      sx={{ borderRadius: 999, boxShadow: 4, textTransform: 'none', px: 2 }}
    >
      {label}
    </Button>
  );
  return (
    <>
      {!hidden && (
        <Box
          sx={{
            position: 'absolute',
            bottom: 56,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 3,
          }}
        >
          {variant === 'A' && reason ? (
            <Tooltip title={reason}>
              <span>{button}</span>
            </Tooltip>
          ) : (
            button
          )}
        </Box>
      )}
      {onScreen && (
        <PrototypeSwitcher
          state={{
            pivotRows: ids.length,
            ids: ids.map((id) => id ?? '∅').join(', '),
            matches: `${count} shown / ${matches.total} in results`,
            next: next ? `${(at === null ? 0 : (at + 1) % count) + 1}, ${nextPlace}` : '-',
            reason: reason ?? '-',
            link: hidden ? 'hidden' : 'shown',
          }}
        />
      )}
    </>
  );
}

/** PROTOTYPE: the variant switcher, with the hide toggle, the scenario and the link's state. */
function PrototypeSwitcher({ state }: { state: Record<string, string | number> }) {
  const [search, setSearch] = useSearchParams();
  const at = Math.max(
    0,
    VARIANTS.findIndex((v) => v.key === search.get('variant')),
  );
  const set = useCallback(
    (key: string, value: string | null) =>
      setSearch(
        (s) => {
          const n = new URLSearchParams(s);
          if (value === null) n.delete(key);
          else n.set(key, value);
          return n;
        },
        { replace: true },
      ),
    [setSearch],
  );
  const cycle = useCallback(
    (by: number) => set('variant', VARIANTS[(at + by + VARIANTS.length) % VARIANTS.length]!.key),
    [at, set],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, [contenteditable], .ag-root-wrapper')) return;
      if (e.key === 'ArrowLeft') cycle(-1);
      if (e.key === 'ArrowRight') cycle(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cycle]);
  if (!import.meta.env.DEV) return null;
  const variant = VARIANTS[at]!;
  return createPortal(
    <Box
      sx={{
        position: 'fixed',
        top: 8,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 2000,
        bgcolor: '#111',
        color: '#fff',
        borderRadius: 2,
        boxShadow: 8,
        px: 1.5,
        py: 0.5,
        font: '12px/1.5 monospace',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 0.25,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <IconButton size="small" sx={{ color: '#fff' }} onClick={() => cycle(-1)}>
          <ChevronLeftIcon fontSize="small" />
        </IconButton>
        <span>
          PROTOTYPE #249 · {variant.key} ({variant.name})
        </span>
        <IconButton size="small" sx={{ color: '#fff' }} onClick={() => cycle(1)}>
          <ChevronRightIcon fontSize="small" />
        </IconButton>
        <label>
          <input
            type="checkbox"
            checked={search.get('hide') === '1'}
            onChange={(e) => set('hide', e.target.checked ? '1' : null)}
          />{' '}
          hide while on screen
        </label>
        <select
          value={search.get('scenario') ?? 'real'}
          onChange={(e) => set('scenario', e.target.value === 'real' ? null : e.target.value)}
        >
          {SCENARIOS.map((s) => (
            <option key={s} value={s}>
              scenario: {s}
            </option>
          ))}
        </select>
      </Box>
      <span>
        {Object.entries(state)
          .map(([k, v]) => `${k}: ${v}`)
          .join(' · ')}
      </span>
    </Box>,
    document.body,
  );
}
