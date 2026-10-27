/* eslint-disable react-refresh/only-export-components -- PROTOTYPE (#170) */
// PROTOTYPE (#170, throwaway): the floating bar that switches a prototype's variants. Lives on the
// prototype/170-row-detail branch only; never merge it.
import ChevronLeft from '@mui/icons-material/ChevronLeft';
import ChevronRight from '@mui/icons-material/ChevronRight';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';

// The settings live in the query string before the hash (`/?variant=B#/view/…`), so they survive
// switching tabs, which changes only the hash route, and a reload, and can be shared.
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const search = () => window.location.search;

/** The prototype's URL setting `name`, else `fallback`. */
export function usePrototypeParam(name: string, fallback: string): string {
  const query = useSyncExternalStore(subscribe, search);
  return new URLSearchParams(query).get(name) ?? fallback;
}

/** Sets the URL setting `name` without a reload or a route change. */
export function setPrototypeParam(name: string, value: string) {
  const params = new URLSearchParams(window.location.search);
  params.set(name, value);
  window.history.replaceState(window.history.state, '', `?${params}${window.location.hash}`);
  listeners.forEach((l) => l());
}

export interface PrototypeVariant {
  key: string;
  name: string;
}

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/**
 * Bottom-centre pill: ‹ variant › and any extra settings. `[` and `]` cycle the variants too (the
 * arrow keys belong to the grid). Not rendered in a production build.
 */
export function PrototypeSwitcher({
  variants,
  current,
  children,
}: {
  variants: readonly PrototypeVariant[];
  current: string;
  /** More settings, after the variant. */
  children?: ReactNode;
}) {
  const index = Math.max(
    0,
    variants.findIndex((v) => v.key === current),
  );
  const go = (step: number) => {
    const next = variants[(index + step + variants.length) % variants.length];
    if (next) setPrototypeParam('variant', next.key);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '[') go(-1);
      if (e.key === ']') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  if (!import.meta.env.DEV) return null;
  const shown = variants[index];
  return (
    <Box
      sx={{
        position: 'fixed',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 2000,
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 1,
        py: 0.5,
        borderRadius: 999,
        bgcolor: '#111',
        color: '#fff',
        boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        fontSize: 13,
        fontFamily: 'system-ui, sans-serif',
        '& select': {
          bgcolor: '#222',
          color: '#fff',
          border: '1px solid #555',
          borderRadius: 1,
          fontSize: 12,
          px: 0.5,
        },
      }}
    >
      <Box component="span" sx={{ color: '#f5c518', fontWeight: 700, pl: 1 }}>
        PROTOTYPE
      </Box>
      <IconButton
        size="small"
        aria-label="Previous variant"
        onClick={() => go(-1)}
        sx={{ color: '#fff' }}
      >
        <ChevronLeft fontSize="small" />
      </IconButton>
      <Box component="span" sx={{ minWidth: 190, textAlign: 'center' }}>
        {shown ? `${shown.key} (${shown.name})` : current}
      </Box>
      <IconButton
        size="small"
        aria-label="Next variant"
        onClick={() => go(1)}
        sx={{ color: '#fff' }}
      >
        <ChevronRight fontSize="small" />
      </IconButton>
      {children}
    </Box>
  );
}

/** A labelled `<select>` for one URL setting of the bar. */
export function PrototypeSetting({
  name,
  label,
  options,
  value,
}: {
  name: string;
  label: string;
  options: readonly string[];
  value: string;
}) {
  return (
    <Box component="label" sx={{ display: 'flex', gap: 0.5, alignItems: 'center', pr: 0.5 }}>
      {label}
      <select value={value} onChange={(e) => setPrototypeParam(name, e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </Box>
  );
}
