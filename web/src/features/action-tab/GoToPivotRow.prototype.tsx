/* eslint-disable react-refresh/only-export-components -- PROTOTYPE */
/**
 * PROTOTYPE — throwaway. Question: how should Go to pivot row look so it takes less room, uses a
 * less dominant colour, and can be dismissed with an X?
 *
 * Four renderings of the same state on the existing action tab, switchable via `?variant=`:
 *   current  today's contained primary pill (baseline, no X)
 *   A        compact neutral chip, same floating spot, with an X
 *   B        icon-only corner button with a count badge; the X shows on hover/focus
 *   C        no overlay at all: a quiet text link in the grid's status bar, with an X
 *   C2       C without the X; reads "Highlight" when the next row is already in view, and
 *            numbers the row the next click goes to: "(2 of 3)"
 *   C3       C2's Go to link (always "Go to"), plus a "Highlight pivot rows" checkbox that tints
 *            every pivot row (an overlay on the row) with a left accent bar while it's on
 *
 * Dismissing hides it for this tab until the page reloads (in-memory only).
 * Lives on branch prototype/go-to-pivot-row only; never merge it into main.
 */
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import CloseIcon from '@mui/icons-material/Close';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import Badge from '@mui/material/Badge';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PrototypeVariant } from '../../components/PrototypeSwitcher.prototype';

export const GO_TO_PIVOT_ROW_VARIANTS: readonly PrototypeVariant[] = [
  { key: 'current', name: 'Current contained pill' },
  { key: 'A', name: 'Compact neutral chip' },
  { key: 'B', name: 'Corner icon + badge' },
  { key: 'C', name: 'Status-bar link' },
  { key: 'C2', name: 'Status-bar link: Go to / Highlight, no X' },
  { key: 'C3', name: 'Status-bar link + Highlight pivot rows checkbox' },
];

export interface VariantProps {
  /** Rows the filters let through with a pivot row's id. */
  count: number;
  /** Index of the row last gone to, else null. */
  at: number | null;
  /** Whether the next row is above the viewport. */
  up: boolean;
  /** Whether the next row is wholly in the viewport. */
  inView: boolean;
  /** Index, in the cycle, of the row the next click goes to. */
  nextAt: number;
  /** Row numbers of the pivot rows the filters let through, in grid order. */
  rows: readonly number[];
  /** No row to go to. */
  disabled: boolean;
  /** Why it's disabled, else null. */
  reason: string | null;
  onGo: () => void;
  onDismiss: () => void;
}

/** "2 of 3", "3", or "" */
function position(count: number, at: number | null, sep = ' of '): string {
  if (count <= 1) return '';
  return at === null ? `${count}` : `${at + 1}${sep}${count}`;
}

export function VariantCurrent({ count, at, up, disabled, reason, onGo }: VariantProps) {
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
            startIcon={up ? <ArrowUpwardIcon /> : <ArrowDownwardIcon />}
            disabled={disabled}
            onClick={onGo}
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

/** A: same floating spot, but a small neutral outlined chip with a divider and an X. */
export function VariantA({ count, at, up, disabled, reason, onGo, onDismiss }: VariantProps) {
  const Arrow = up ? ArrowUpwardIcon : ArrowDownwardIcon;
  const pos = position(count, at, '/');
  return (
    <Box
      sx={{
        position: 'absolute',
        bottom: 52,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 3,
        display: 'flex',
        alignItems: 'center',
        height: 24,
        borderRadius: 999,
        border: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
        boxShadow: 1,
        color: 'text.secondary',
        fontSize: 12,
        overflow: 'hidden',
      }}
    >
      <Tooltip title={reason ?? 'Go to the next pivot row'}>
        <span style={{ height: '100%', display: 'flex' }}>
          <ButtonBase
            onClick={onGo}
            disabled={disabled}
            sx={{
              pl: 1,
              pr: 0.75,
              gap: 0.5,
              fontSize: 12,
              color: 'inherit',
              '&:hover': { color: 'text.primary', bgcolor: 'action.hover' },
              '&.Mui-disabled': { opacity: 0.5 },
            }}
          >
            <Arrow sx={{ fontSize: 14 }} />
            Pivot row
            {pos && (
              <Box component="span" sx={{ fontVariantNumeric: 'tabular-nums', opacity: 0.8 }}>
                {pos}
              </Box>
            )}
          </ButtonBase>
        </span>
      </Tooltip>
      <Divider orientation="vertical" flexItem />
      <IconButton
        aria-label="Dismiss Go to pivot row"
        onClick={onDismiss}
        sx={{ borderRadius: 0, px: 0.5, color: 'inherit', '&:hover': { color: 'text.primary' } }}
      >
        <CloseIcon sx={{ fontSize: 14 }} />
      </IconButton>
    </Box>
  );
}

/**
 * B: icon only, tucked into the grid's bottom-right corner above the status bar (clear of the
 * vertical scrollbar). The label is the tooltip; the count is a badge; the X appears on hover/focus.
 */
export function VariantB({ count, at, up, disabled, reason, onGo, onDismiss }: VariantProps) {
  const Arrow = up ? ArrowUpwardIcon : ArrowDownwardIcon;
  const pos = position(count, at);
  const tip = reason ?? `Go to pivot row${pos ? ` (${pos})` : ''}`;
  return (
    <Box
      sx={{
        position: 'absolute',
        bottom: 52,
        right: 28,
        zIndex: 3,
        '& .dismiss': { opacity: 0, transition: 'opacity 120ms' },
        '&:hover .dismiss, &:focus-within .dismiss': { opacity: 1 },
      }}
    >
      <Tooltip title={tip} placement="left">
        <span>
          <Badge
            badgeContent={count > 1 ? count : 0}
            color="default"
            overlap="circular"
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
            sx={{
              '& .MuiBadge-badge': {
                bgcolor: 'background.paper',
                border: 1,
                borderColor: 'divider',
                color: 'text.secondary',
                fontSize: 10,
                height: 16,
                minWidth: 16,
                px: 0.5,
              },
            }}
          >
            <IconButton
              aria-label={tip}
              onClick={onGo}
              disabled={disabled}
              sx={{
                width: 32,
                height: 32,
                bgcolor: 'background.paper',
                border: 1,
                borderColor: 'divider',
                boxShadow: 2,
                color: 'text.secondary',
                '&:hover': { bgcolor: 'background.paper', color: 'primary.main' },
              }}
            >
              <Arrow sx={{ fontSize: 18 }} />
            </IconButton>
          </Badge>
        </span>
      </Tooltip>
      <IconButton
        className="dismiss"
        aria-label="Dismiss Go to pivot row"
        onClick={onDismiss}
        sx={{
          position: 'absolute',
          top: -8,
          right: -8,
          width: 18,
          height: 18,
          p: 0,
          bgcolor: 'background.paper',
          border: 1,
          borderColor: 'divider',
          color: 'text.secondary',
          '&:hover': { bgcolor: 'background.paper', color: 'text.primary' },
        }}
      >
        <CloseIcon sx={{ fontSize: 12 }} />
      </IconButton>
    </Box>
  );
}

/**
 * C: no overlay over the rows. A quiet text link portalled into the centre of AG Grid's status
 * bar (between the column view and the row counts), with an X.
 */
export function VariantC({ count, at, up, disabled, reason, onGo, onDismiss }: VariantProps) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [target, setTarget] = useState<Element | null>(null);
  useLayoutEffect(() => {
    // The grid may render its status bar after us; poll briefly for it.
    let tries = 0;
    const id = setInterval(() => {
      const found = anchor.current?.parentElement?.querySelector('.ag-status-bar-center') ?? null;
      if (found || ++tries > 50) {
        setTarget(found);
        clearInterval(id);
      }
    }, 50);
    return () => clearInterval(id);
  }, []);
  const Arrow = up ? ArrowUpwardIcon : ArrowDownwardIcon;
  const pos = position(count, at);
  const content = (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        height: '100%',
        gap: 0.25,
        color: 'text.secondary',
        fontSize: 'inherit',
      }}
    >
      <Tooltip title={reason ?? ''}>
        <span>
          <ButtonBase
            onClick={onGo}
            disabled={disabled}
            sx={{
              gap: 0.5,
              px: 0.75,
              py: 0.25,
              borderRadius: 1,
              fontSize: 'inherit',
              color: 'inherit',
              '&:hover': { color: 'primary.main', textDecoration: 'underline' },
              '&.Mui-disabled': { opacity: 0.5 },
            }}
          >
            <Arrow sx={{ fontSize: 14 }} />
            Go to pivot row{pos && ` (${pos})`}
          </ButtonBase>
        </span>
      </Tooltip>
      <IconButton
        aria-label="Dismiss Go to pivot row"
        onClick={onDismiss}
        sx={{ p: 0.25, color: 'inherit', '&:hover': { color: 'text.primary' } }}
      >
        <CloseIcon sx={{ fontSize: 13 }} />
      </IconButton>
    </Box>
  );
  return (
    <>
      <span ref={anchor} hidden />
      {target && createPortal(content, target)}
    </>
  );
}

/** The centre of the grid's status bar, found from a hidden anchor next to the grid. */
function useStatusBarCentre() {
  const anchor = useRef<HTMLSpanElement>(null);
  const [target, setTarget] = useState<Element | null>(null);
  useLayoutEffect(() => {
    let tries = 0;
    const id = setInterval(() => {
      const found = anchor.current?.parentElement?.querySelector('.ag-status-bar-center') ?? null;
      if (found || ++tries > 50) {
        setTarget(found);
        clearInterval(id);
      }
    }, 50);
    return () => clearInterval(id);
  }, []);
  return { anchor, target };
}

/**
 * C2: C without the X. The label says what the next click does, to which row of the cycle:
 * "↓ Go to pivot row (2 of 3)" when that row is off screen, "◎ Highlight pivot row (2 of 3)" when
 * it is already in view (the click then only focuses and flashes it).
 */
export function VariantC2({ count, nextAt, up, inView, disabled, reason, onGo }: VariantProps) {
  const { anchor, target } = useStatusBarCentre();
  const Icon = inView ? MyLocationIcon : up ? ArrowUpwardIcon : ArrowDownwardIcon;
  const verb = inView ? 'Highlight' : 'Go to';
  const pos = count > 1 ? ` (${nextAt + 1} of ${count})` : '';
  const content = (
    <Box sx={{ display: 'flex', alignItems: 'center', height: '100%', color: 'text.secondary' }}>
      <Tooltip title={reason ?? ''}>
        <span>
          <ButtonBase
            onClick={onGo}
            disabled={disabled}
            sx={{
              gap: 0.5,
              px: 0.75,
              py: 0.25,
              borderRadius: 1,
              fontSize: 'inherit',
              color: 'inherit',
              fontVariantNumeric: 'tabular-nums',
              '&:hover': { color: 'primary.main', textDecoration: 'underline' },
              '&.Mui-disabled': { opacity: 0.5 },
            }}
          >
            <Icon sx={{ fontSize: 14 }} />
            {verb} pivot row{pos}
          </ButtonBase>
        </span>
      </Tooltip>
    </Box>
  );
  return (
    <>
      <span ref={anchor} hidden />
      {target && createPortal(content, target)}
    </>
  );
}

/**
 * C3: "↓ Go to pivot row (2 of 3)" · "☐ Highlight pivot rows". The checkbox tints every pivot row
 * and gives it a left accent bar, over any label colour, until it is unticked (in memory, per tab; ticked when the tab opens).
 */
export function VariantC3({ count, nextAt, up, disabled, reason, onGo, rows }: VariantProps) {
  const { anchor, target } = useStatusBarCentre();
  const [highlight, setHighlight] = useState(true);
  // Scope the style to this tab's grid: mark the box that wraps it.
  const [scope] = useState(() => `proto-pivot-${Math.random().toString(36).slice(2)}`);
  useLayoutEffect(() => {
    const box = anchor.current?.parentElement;
    box?.classList.add(scope);
    return () => box?.classList.remove(scope);
  }, [anchor, scope]);
  const Arrow = up ? ArrowUpwardIcon : ArrowDownwardIcon;
  const pos = count > 1 ? ` (${nextAt + 1} of ${count})` : '';
  const tint = 'color-mix(in srgb, var(--mui-palette-primary-main) 12%, transparent)';
  const css =
    highlight && rows.length > 0
      ? `${rows.map((r) => `.${scope} .ag-row[row-id="${r}"]::after`).join(',\n')} {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 1;
  background: ${tint};
}
${rows.map((r) => `.${scope} .ag-row[row-id="${r}"] .ag-cell[col-id="ag-Grid-SelectionColumn"]`).join(',\n')} {
  background-image: linear-gradient(${tint}, ${tint});
  box-shadow: inset 3px 0 0 var(--mui-palette-primary-main);
}`
      : '';
  const content = (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        height: '100%',
        gap: 1,
        color: 'text.secondary',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      <Tooltip title={reason ?? ''}>
        <span>
          <ButtonBase
            onClick={onGo}
            disabled={disabled}
            sx={{
              gap: 0.5,
              px: 0.75,
              py: 0.25,
              borderRadius: 1,
              fontSize: 'inherit',
              color: 'inherit',
              '&:hover': { color: 'primary.main', textDecoration: 'underline' },
              '&.Mui-disabled': { opacity: 0.5 },
            }}
          >
            <Arrow sx={{ fontSize: 14 }} />
            Go to pivot row{pos}
          </ButtonBase>
        </span>
      </Tooltip>
      <Divider orientation="vertical" flexItem sx={{ my: 1 }} />
      <FormControlLabel
        disabled={count === 0}
        control={
          <Checkbox
            size="small"
            checked={highlight}
            onChange={(e) => setHighlight(e.target.checked)}
            sx={{ p: 0.25, '& svg': { fontSize: 16 } }}
          />
        }
        label="Highlight pivot rows"
        sx={{
          m: 0,
          gap: 0.25,
          color: 'inherit',
          '& .MuiFormControlLabel-label': { fontSize: 'inherit' },
        }}
      />
    </Box>
  );
  return (
    <>
      <span ref={anchor} hidden />
      {css && <style>{css}</style>}
      {target && createPortal(content, target)}
    </>
  );
}
