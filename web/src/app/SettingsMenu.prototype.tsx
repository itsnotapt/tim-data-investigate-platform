// PROTOTYPE (wayfinder #38): three variants of the toolbar Settings menu with a
// Light / Dark / System choice, switchable via ?variant=A|B|C on any route.
// Throwaway: lives on branch prototype/theme-mode-menu only.
import CheckIcon from '@mui/icons-material/Check';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import SettingsBrightnessOutlinedIcon from '@mui/icons-material/SettingsBrightnessOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import ListSubheader from '@mui/material/ListSubheader';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { useColorScheme } from '@mui/material/styles';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { Link as RouterLink } from 'react-router';

type Mode = 'light' | 'dark' | 'system';

const MODES: { mode: Mode; label: string; icon: ReactElement }[] = [
  { mode: 'light', label: 'Light', icon: <LightModeOutlinedIcon fontSize="small" /> },
  { mode: 'dark', label: 'Dark', icon: <DarkModeOutlinedIcon fontSize="small" /> },
  { mode: 'system', label: 'System', icon: <SettingsBrightnessOutlinedIcon fontSize="small" /> },
];

export const VARIANTS = [
  { key: 'A', name: 'Inline radio items' },
  { key: 'B', name: 'Theme sub-menu' },
  { key: 'C', name: 'Segmented control' },
] as const;

const cap = (s: string | undefined) => (s ? s[0]!.toUpperCase() + s.slice(1) : '?');

function useMode() {
  const { mode, setMode } = useColorScheme();
  // MUI only reports systemMode while mode is 'system'; read the OS directly so it's always known.
  const systemMode = useMediaQuery('(prefers-color-scheme: dark)') ? 'dark' : 'light';
  const current: Mode = mode ?? 'system';
  const effective = current === 'system' ? systemMode : current;
  return { current, systemMode, effective, setMode };
}

function useAnchor() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return { anchor, open: setAnchor, close: () => setAnchor(null) };
}

function SettingsButton({
  anchor,
  onOpen,
}: {
  anchor: HTMLElement | null;
  onOpen: (el: HTMLElement) => void;
}) {
  return (
    <IconButton
      aria-label="Settings"
      aria-haspopup="menu"
      aria-expanded={anchor ? true : undefined}
      onClick={(e) => onOpen(e.currentTarget)}
    >
      <SettingsOutlinedIcon />
    </IconButton>
  );
}

function ExportImportItem({ onClick }: { onClick: () => void }) {
  return (
    <MenuItem component={RouterLink} to="/exportimport" onClick={onClick}>
      Export / Import
    </MenuItem>
  );
}

/**
 * A: a "Theme" heading with three radio items directly in the Settings menu.
 * Picking one applies it immediately and keeps the menu open so the change is visible.
 */
export function VariantA() {
  const { anchor, open, close } = useAnchor();
  const { current, systemMode, setMode } = useMode();
  return (
    <>
      <SettingsButton anchor={anchor} onOpen={open} />
      <Menu anchorEl={anchor} open={anchor !== null} onClose={close}>
        <ListSubheader sx={{ lineHeight: '32px' }}>Theme</ListSubheader>
        {MODES.map(({ mode, label, icon }) => (
          <MenuItem
            key={mode}
            role="menuitemradio"
            aria-checked={current === mode}
            aria-label={`Theme: ${label}${mode === 'system' ? `, currently ${systemMode}` : ''}`}
            selected={current === mode}
            onClick={() => setMode(mode)}
          >
            <ListItemIcon>{icon}</ListItemIcon>
            <ListItemText
              primary={label}
              secondary={mode === 'system' ? `Currently ${cap(systemMode)}` : undefined}
            />
            <CheckIcon
              fontSize="small"
              sx={{ ml: 2, visibility: current === mode ? 'visible' : 'hidden' }}
            />
          </MenuItem>
        ))}
        <Divider />
        <ExportImportItem onClick={close} />
      </Menu>
    </>
  );
}

/**
 * B: one "Theme" item (no current value shown), opening a sub-menu of three radio items.
 * ArrowRight / Enter opens it, ArrowLeft / Escape returns; picking closes both menus.
 */
function VariantB() {
  const { anchor, open, close } = useAnchor();
  const sub = useAnchor();
  const themeItem = useRef<HTMLLIElement>(null);
  const { current, setMode } = useMode();
  const closeAll = () => {
    sub.close();
    close();
  };
  const backToParent = () => {
    sub.close();
    themeItem.current?.focus();
  };
  return (
    <>
      <SettingsButton anchor={anchor} onOpen={open} />
      <Menu anchorEl={anchor} open={anchor !== null} onClose={closeAll}>
        <MenuItem
          ref={themeItem}
          aria-haspopup="menu"
          aria-expanded={sub.anchor ? true : undefined}
          onClick={(e) => sub.open(e.currentTarget)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') sub.open(e.currentTarget);
          }}
        >
          <ListItemText primary="Theme" />
          <ChevronRightIcon fontSize="small" sx={{ ml: 3, color: 'text.secondary' }} />
        </MenuItem>
        <ExportImportItem onClick={close} />
      </Menu>
      <Menu
        anchorEl={sub.anchor}
        open={sub.anchor !== null}
        onClose={backToParent}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          list: {
            'aria-label': 'Theme',
            onKeyDown: (e: KeyboardEvent) => {
              if (e.key === 'ArrowLeft') backToParent();
            },
          },
        }}
      >
        {MODES.map(({ mode, label, icon }) => (
          <MenuItem
            key={mode}
            role="menuitemradio"
            aria-checked={current === mode}
            selected={current === mode}
            onClick={() => {
              setMode(mode);
              closeAll();
            }}
          >
            <ListItemIcon>{icon}</ListItemIcon>
            <ListItemText primary={label} />
            <CheckIcon
              fontSize="small"
              sx={{ ml: 2, visibility: current === mode ? 'visible' : 'hidden' }}
            />
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

/**
 * C: a three-way segmented control at the top of the Settings menu, a caption under it
 * saying what System resolves to. The control is one menu stop; ArrowLeft / ArrowRight
 * (or clicking) change the choice live, ArrowDown moves on to Export / Import.
 */
export function VariantC() {
  const { anchor, open, close } = useAnchor();
  const { current, systemMode, setMode } = useMode();
  const step = (delta: number) => {
    const i = MODES.findIndex((m) => m.mode === current);
    setMode(MODES[(i + delta + MODES.length) % MODES.length]!.mode);
  };
  return (
    <>
      <SettingsButton anchor={anchor} onOpen={open} />
      <Menu anchorEl={anchor} open={anchor !== null} onClose={close}>
        <MenuItem
          disableRipple
          role="radiogroup"
          aria-label="Theme"
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.preventDefault();
              e.stopPropagation();
              step(e.key === 'ArrowLeft' ? -1 : 1);
            }
          }}
          sx={{
            px: 2,
            pt: 1,
            pb: 1.5,
            display: 'block',
            cursor: 'default',
            '&:hover, &.Mui-focusVisible': { backgroundColor: 'transparent' },
            outline: 'none',
            '&.Mui-focusVisible': {
              boxShadow: (t) => `inset 0 0 0 2px ${t.vars!.palette.primary.main}`,
            },
          }}
        >
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.5 }}>
            Theme
          </Typography>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={current}
            onChange={(_, v: Mode | null) => v && setMode(v)}
          >
            {MODES.map(({ mode, label, icon }) => (
              <ToggleButton
                key={mode}
                value={mode}
                role="radio"
                aria-checked={current === mode}
                tabIndex={-1}
                sx={{ gap: 0.75, px: 1.5, textTransform: 'none' }}
              >
                {icon}
                {label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <Typography
            variant="caption"
            color="text.secondary"
            component="div"
            aria-live="polite"
            sx={{ mt: 0.75, minHeight: '1.5em' }}
          >
            {current === 'system' ? `Following your system: ${cap(systemMode)}` : ''}
          </Typography>
        </MenuItem>
        <Divider />
        <ExportImportItem onClick={close} />
      </Menu>
    </>
  );
}

export function PrototypeSettingsMenu() {
  // #40: variant B was chosen in #38; the palette prototype owns the switcher now.
  return <VariantB />;
}
