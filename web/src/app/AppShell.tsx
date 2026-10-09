import BugReportIcon from '@mui/icons-material/BugReport';
import CheckIcon from '@mui/icons-material/Check';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import HelpIcon from '@mui/icons-material/Help';
import InfoIcon from '@mui/icons-material/Info';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import MenuIcon from '@mui/icons-material/Menu';
import PersonIcon from '@mui/icons-material/Person';
import SettingsBrightnessOutlinedIcon from '@mui/icons-material/SettingsBrightnessOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { useColorScheme } from '@mui/material/styles';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import {
  Suspense,
  useCallback,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Link as RouterLink, Outlet, useLocation } from 'react-router';
import { useNotify } from '../components';
import { useAuth } from '../lib/auth';
import { getConfig } from '../lib/config/runtimeConfig';
import { SIDE_TREE_COLLAPSED_WIDTH, SideTree } from '../features/tree';
import { useTemplatesStore } from '../features/templates';
import { AuthGate } from './AuthGate';
import type { ThemeMode } from './themeKeys';

interface ToolbarMenuProps {
  label: string;
  icon: ReactElement;
  /** Receives a `close` callback; must return MenuItems. */
  children: (close: () => void) => ReactNode;
}

function ToolbarMenu({ label, icon, children }: ToolbarMenuProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = () => setAnchor(null);
  return (
    <>
      <IconButton
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={anchor ? true : undefined}
        onClick={(e) => setAnchor(e.currentTarget)}
      >
        {icon}
      </IconButton>
      <Menu anchorEl={anchor} open={anchor !== null} onClose={close}>
        {children(close)}
      </Menu>
    </>
  );
}

const THEME_MODES: { mode: ThemeMode; label: string; icon: ReactElement }[] = [
  { mode: 'light', label: 'Light', icon: <LightModeOutlinedIcon fontSize="small" /> },
  { mode: 'dark', label: 'Dark', icon: <DarkModeOutlinedIcon fontSize="small" /> },
  { mode: 'system', label: 'System', icon: <SettingsBrightnessOutlinedIcon fontSize="small" /> },
];

/**
 * Settings: `Theme ›` opens a Light / Dark / System sub-menu, a `Menu` beside the Settings menu.
 * Picking one applies it and closes both menus.
 */
function SettingsMenu() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [themeAnchor, setThemeAnchor] = useState<HTMLElement | null>(null);
  const themeItem = useRef<HTMLLIElement>(null);
  const { mode, setMode } = useColorScheme();
  const current: ThemeMode = mode ?? 'system';
  const closeAll = () => {
    setThemeAnchor(null);
    setAnchor(null);
  };
  const backToTheme = () => {
    setThemeAnchor(null);
    themeItem.current?.focus();
  };
  return (
    <>
      <IconButton
        aria-label="Settings"
        aria-haspopup="menu"
        aria-expanded={anchor ? true : undefined}
        onClick={(e) => setAnchor(e.currentTarget)}
      >
        <SettingsOutlinedIcon />
      </IconButton>
      <Menu anchorEl={anchor} open={anchor !== null} onClose={closeAll}>
        <MenuItem
          ref={themeItem}
          aria-haspopup="menu"
          aria-expanded={themeAnchor !== null}
          onClick={(e) => setThemeAnchor(e.currentTarget)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') setThemeAnchor(e.currentTarget);
          }}
        >
          <ListItemText primary="Theme" />
          <ChevronRightIcon fontSize="small" sx={{ ml: 3, color: 'text.secondary' }} />
        </MenuItem>
        <MenuItem component={RouterLink} to="/exportimport" onClick={closeAll}>
          Export / Import
        </MenuItem>
      </Menu>
      <Menu
        anchorEl={themeAnchor}
        open={themeAnchor !== null}
        onClose={backToTheme}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          list: {
            'aria-label': 'Theme',
            onKeyDown: (e: KeyboardEvent) => {
              if (e.key === 'ArrowLeft') backToTheme();
            },
          },
        }}
      >
        {THEME_MODES.map(({ mode: option, label, icon }) => (
          <MenuItem
            key={option}
            role="menuitemradio"
            aria-checked={current === option}
            selected={current === option}
            onClick={() => {
              setMode(option);
              closeAll();
            }}
          >
            <ListItemIcon>{icon}</ListItemIcon>
            <ListItemText primary={label} />
            <CheckIcon
              fontSize="small"
              sx={{ ml: 2, visibility: current === option ? 'visible' : 'hidden' }}
            />
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

function AccountMenu() {
  const { status, account, login, logout } = useAuth();
  const notify = useNotify();
  return (
    <ToolbarMenu label="Account" icon={<PersonIcon />}>
      {(close) => [
        account && (
          <MenuItem key="name" disabled>
            {account.name}
          </MenuItem>
        ),
        status === 'signedIn' ? (
          <MenuItem
            key="out"
            onClick={() => {
              close();
              void logout().then(() => notify('You have successfully logged out.'));
            }}
          >
            Sign out
          </MenuItem>
        ) : (
          <MenuItem
            key="in"
            onClick={() => {
              close();
              void login();
            }}
          >
            Sign in
          </MenuItem>
        ),
      ]}
    </ToolbarMenu>
  );
}

/** Side tree plus the routed page; only rendered once signed in and bootstrapped. */
function ShellContent() {
  const templates = useTemplatesStore((s) => s.templates);
  const queryOptions = useTemplatesStore((s) => s.queryOptions);
  const notify = useNotify();
  const onReloadTemplates = useCallback(async () => {
    try {
      await useTemplatesStore.getState().reload();
    } catch (e) {
      notify(`Failed to reload templates: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [notify]);
  return (
    <>
      <SideTree
        templates={templates}
        queryOptions={queryOptions}
        onReloadTemplates={onReloadTemplates}
      />
      <Box sx={{ ml: `${SIDE_TREE_COLLAPSED_WIDTH}px` }}>
        <Suspense fallback={<CircularProgress aria-label="Loading page" sx={{ m: 2 }} />}>
          <Outlet />
        </Suspense>
      </Box>
    </>
  );
}

export function AppShell() {
  const { wikiUri, issueUri } = getConfig();
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <AppBar position="static">
        <Toolbar disableGutters sx={{ px: 1 }}>
          <ToolbarMenu label="Menu" icon={<MenuIcon />}>
            {(close) => (
              <MenuItem component={RouterLink} to="/queries" onClick={close}>
                Query Manager
              </MenuItem>
            )}
          </ToolbarMenu>
          <Typography
            variant="h6"
            component="h1"
            sx={{ fontSize: '1.25rem', fontWeight: 400, ml: 0.5 }}
          >
            <RouterLink to="/" style={{ color: 'inherit', textDecoration: 'none' }}>
              TIM
            </RouterLink>
          </Typography>
          <Box sx={{ flexGrow: 1 }} />
          <ToolbarMenu label="Help" icon={<HelpIcon />}>
            {(close) => [
              <MenuItem
                key="wiki"
                component="a"
                href={wikiUri}
                target="_blank"
                rel="noopener noreferrer"
                onClick={close}
              >
                Wiki Page
                <ListItemIcon sx={{ ml: 2, minWidth: 0 }}>
                  <InfoIcon fontSize="small" />
                </ListItemIcon>
              </MenuItem>,
              <MenuItem
                key="bug"
                component="a"
                href={issueUri}
                target="_blank"
                rel="noopener noreferrer"
                onClick={close}
              >
                Report a bug
                <ListItemIcon sx={{ ml: 2, minWidth: 0 }}>
                  <BugReportIcon fontSize="small" />
                </ListItemIcon>
              </MenuItem>,
            ]}
          </ToolbarMenu>
          <SettingsMenu />
          <AccountMenu />
        </Toolbar>
      </AppBar>
      <Box component="main" sx={{ flexGrow: 1, p: 3, position: 'relative' }}>
        {/* PROTOTYPE (#44): prototype routes skip sign-in and bootstrap (no api needed). */}
        {useLocation().pathname.startsWith('/prototype') ? (
          <Outlet />
        ) : (
          <AuthGate>
            <ShellContent />
          </AuthGate>
        )}
      </Box>
    </Box>
  );
}
