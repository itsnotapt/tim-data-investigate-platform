// PROTOTYPE: throwaway variants of the action tab's header, the area above the results grid.
// Four variants on the existing /view/:uuid route, switchable via `?variant=` (A is today's layout).
// Question: how should New, the title, Save…/Clone/Copy link, the pills, Run, the inner tabs and
// the quick filter be laid out so the grid gets more of the screen? Not for main.
/* eslint-disable react-refresh/only-export-components -- prototype */
import AddIcon from '@mui/icons-material/Add';
import BookmarkAddIcon from '@mui/icons-material/BookmarkAdd';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import LinkIcon from '@mui/icons-material/Link';
import SearchIcon from '@mui/icons-material/Search';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { createContext, useContext, type ReactNode, type SetStateAction } from 'react';
import { createPortal } from 'react-dom';
import { usePrototypeVariant, type PrototypeVariant } from '../../components/PrototypeSwitcher';
import { NewQueryMenu } from '../new-query';

export const ACTION_TAB_HEADER_VARIANTS: PrototypeVariant[] = [
  { key: 'A', name: 'Today' },
  { key: 'B', name: 'One toolbar' },
  { key: 'C', name: 'Title in the app bar, Run after the pills' },
  { key: 'C2', name: 'Title in the app bar, Run first' },
  { key: 'D', name: 'Params side panel' },
];

export const useHeaderVariant = () => usePrototypeVariant(ACTION_TAB_HEADER_VARIANTS);

/** `<main>`'s padding per variant: today's 24px all round, else tighter. */
export const mainPadding = (variant: string) =>
  variant === 'A' ? { p: 3 } : { px: 2, pt: 1, pb: 1 };

/** The id of the slot in the app bar that variant C fills with the active tab's header. */
export const APP_BAR_SLOT = 'prototype-app-bar-slot';

/**
 * What a variant tells the results grid: where to render its quick filter (null: in its own
 * toolbar, as today) and how tall to be.
 */
export interface GridPlacement {
  quickFilterSlot: HTMLElement | null;
  height?: string;
}
export const GridPlacementContext = createContext<GridPlacement>({ quickFilterSlot: null });

/** The results grid's quick filter: today's labelled field, or a compact one in a variant's slot. */
export function QuickFilter({
  value,
  onChange,
  toolbar,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Today's toolbar row, used when the variant gives no slot. */
  toolbar: (field: ReactNode) => ReactNode;
}) {
  const { quickFilterSlot } = useContext(GridPlacementContext);
  if (!quickFilterSlot)
    return toolbar(
      <TextField
        size="small"
        label="Quick UI filter"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        sx={{ flex: 7 }}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          },
        }}
      />,
    );
  return createPortal(
    <TextField
      size="small"
      placeholder="Filter rows"
      aria-label="Quick UI filter"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      sx={{
        width: 280,
        '& .MuiInputBase-root': { fontSize: '0.875rem' },
        '& .MuiInputBase-input': { py: 0.75 },
      }}
      slotProps={{
        input: {
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon fontSize="small" />
            </InputAdornment>
          ),
        },
      }}
    />,
    quickFilterSlot,
  );
}

/** The pieces of an action tab every variant lays out. */
export interface HeaderParts {
  title: string;
  /** "menu path · action name". */
  caption: ReactNode;
  save: { disabled: boolean; onClick: () => void };
  clone: { onClick: () => void };
  copyLink: { disabled: boolean; onClick: () => void };
  /** The pills bar, given what goes at its end, and whether that sits right after the pills. */
  pillsBar: (end: ReactNode, endInline?: boolean) => ReactNode;
  /** Run, or the run going with Cancel. */
  run: ReactNode;
  /** Results / Run (/ Query) tabs. */
  innerTabs: ReactNode;
  /** Alerts below the pills (action gone, pivot needs params). */
  notices: ReactNode;
  /** The inner tab panels: the editor, the run details, the results grid. */
  panels: ReactNode;
  /** Whether this tab is the one on show (only it may fill the app bar). */
  active: boolean;
  /** Receives the element the quick filter goes in. */
  setQuickFilterSlot: (el: SetStateAction<HTMLElement | null>) => void;
}

function IconAction({
  title,
  icon,
  disabled,
  onClick,
  color,
}: {
  title: string;
  icon: ReactNode;
  disabled?: boolean;
  onClick: () => void;
  color?: string;
}) {
  return (
    <Tooltip title={title}>
      <span>
        <IconButton
          size="small"
          aria-label={title}
          disabled={disabled}
          onClick={onClick}
          sx={color ? { color } : undefined}
        >
          {icon}
        </IconButton>
      </span>
    </Tooltip>
  );
}

function IconActions({ parts, color }: { parts: HeaderParts; color?: string }) {
  return (
    <>
      <IconAction
        title="Save…"
        icon={<BookmarkAddIcon fontSize="small" />}
        color={color}
        {...parts.save}
      />
      <IconAction
        title="Clone"
        icon={<ContentCopyIcon fontSize="small" />}
        color={color}
        {...parts.clone}
      />
      <IconAction
        title="Copy link"
        icon={<LinkIcon fontSize="small" />}
        color={color}
        {...parts.copyLink}
      />
    </>
  );
}

/** The inner tabs on the left and the quick filter's slot on the right, in one row. */
function TabsAndFilter({ parts }: { parts: HeaderParts }) {
  const { innerTabs, setQuickFilterSlot } = parts;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 1 }}>
      {innerTabs}
      <Box ref={setQuickFilterSlot} sx={{ ml: 'auto', display: 'flex' }} />
    </Box>
  );
}

/**
 * B: one toolbar. New, the title (its menu path on hover), the pills, Run and icon-only Save /
 * Clone / Copy link share a row; the inner tabs share the next with the quick filter.
 */
function VariantB({ parts }: { parts: HeaderParts }) {
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, pl: 1 }}>
        <NewQueryMenu size="small">
          <AddIcon fontSize="small" sx={{ mr: 0.5 }} />
          New
        </NewQueryMenu>
        <Divider orientation="vertical" flexItem sx={{ my: 1 }} />
        <Tooltip title={parts.caption} placement="bottom-start">
          <Typography
            variant="subtitle1"
            component="h2"
            noWrap
            sx={{ px: 1, flexShrink: 0, maxWidth: 360 }}
          >
            {parts.title}
          </Typography>
        </Tooltip>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {parts.pillsBar(
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              {parts.run}
              <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
              <IconActions parts={parts} />
            </Box>,
          )}
        </Box>
      </Box>
      {parts.notices}
      <TabsAndFilter parts={parts} />
      {parts.panels}
    </Box>
  );
}

/**
 * C: the title in the app bar. TIM › menu path › title, with icon-only Save / Clone / Copy link,
 * sit in the app bar; the page starts with New, the pills and Run (right after the pills, or with
 * `runFirst` before them), then the inner tabs and the quick filter.
 */
function VariantC({ parts, runFirst = false }: { parts: HeaderParts; runFirst?: boolean }) {
  // AppShell has rendered the app bar before any tab.
  const slot = document.getElementById(APP_BAR_SLOT);
  return (
    <Box>
      {parts.active &&
        slot &&
        createPortal(
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flex: 1 }}>
            <Typography sx={{ opacity: 0.6 }}>›</Typography>
            <Typography variant="body2" noWrap sx={{ opacity: 0.75, flexShrink: 1 }}>
              {parts.caption}
            </Typography>
            <Typography sx={{ opacity: 0.6 }}>›</Typography>
            <Typography variant="subtitle1" component="h2" noWrap sx={{ fontWeight: 500 }}>
              {parts.title}
            </Typography>
            <Box sx={{ display: 'flex', ml: 1 }}>
              <IconActions parts={parts} color="inherit" />
            </Box>
          </Box>,
          slot,
        )}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, pl: 1 }}>
        <NewQueryMenu size="small">
          <AddIcon fontSize="small" sx={{ mr: 0.5 }} />
          New
        </NewQueryMenu>
        <Divider orientation="vertical" flexItem sx={{ my: 1 }} />
        {runFirst && <Box sx={{ px: 0.5, display: 'flex' }}>{parts.run}</Box>}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {runFirst ? parts.pillsBar(null) : parts.pillsBar(parts.run, true)}
        </Box>
      </Box>
      {parts.notices}
      <TabsAndFilter parts={parts} />
      {parts.panels}
    </Box>
  );
}

/**
 * D: a params side panel. A narrow column on the left holds New, the title, the pills one per
 * line, Run and Save / Clone / Copy link; the inner tabs, the quick filter and the grid get the
 * rest, full height.
 */
function VariantD({ parts }: { parts: HeaderParts }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'stretch', gap: 1 }}>
      <Box
        sx={{
          width: 260,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          pr: 1,
          borderRight: 1,
          borderColor: 'divider',
        }}
      >
        <Box>
          <NewQueryMenu size="small">
            <AddIcon fontSize="small" sx={{ mr: 0.5 }} />
            New
          </NewQueryMenu>
        </Box>
        <Box sx={{ px: 1 }}>
          <Typography variant="subtitle1" component="h2" sx={{ lineHeight: 1.3 }}>
            {parts.title}
          </Typography>
          <Typography variant="caption" color="text.secondary" component="div">
            {parts.caption}
          </Typography>
        </Box>
        <Box
          sx={{
            '& > .MuiBox-root': { flexDirection: 'column', alignItems: 'stretch' },
            '& .MuiChip-root': { justifyContent: 'flex-start' },
          }}
        >
          {parts.pillsBar(null)}
        </Box>
        <Box sx={{ px: 1, display: 'flex', '& > *': { flex: 1 } }}>{parts.run}</Box>
        <Divider />
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', px: 0.5 }}>
          <Button size="small" startIcon={<BookmarkAddIcon />} {...parts.save}>
            Save…
          </Button>
          <Button size="small" startIcon={<ContentCopyIcon />} {...parts.clone}>
            Clone
          </Button>
          <Button size="small" startIcon={<LinkIcon />} {...parts.copyLink}>
            Copy link
          </Button>
        </Box>
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {parts.notices}
        <TabsAndFilter parts={parts} />
        {parts.panels}
      </Box>
    </Box>
  );
}

/** The grid's height per variant, so it reaches the bottom of the window. */
const GRID_HEIGHT: Record<string, string> = {
  B: 'calc(100vh - 156px)',
  C: 'calc(100vh - 156px)',
  C2: 'calc(100vh - 156px)',
  D: 'calc(100vh - 110px)',
};

/** Lays the parts out as `variant` (B, C, C2 or D) says, and tells the grid where its filter goes. */
export function PrototypeActionTabLayout({
  variant,
  parts,
  quickFilterSlot,
}: {
  variant: string;
  parts: HeaderParts;
  quickFilterSlot: HTMLElement | null;
}) {
  return (
    <GridPlacementContext value={{ quickFilterSlot, height: GRID_HEIGHT[variant] }}>
      {variant === 'B' && <VariantB parts={parts} />}
      {variant === 'C' && <VariantC parts={parts} />}
      {variant === 'C2' && <VariantC parts={parts} runFirst />}
      {variant === 'D' && <VariantD parts={parts} />}
    </GridPlacementContext>
  );
}
