/* eslint-disable react-refresh/only-export-components -- PROTOTYPE */
/**
 * PROTOTYPE — throwaway. A floating bottom bar that cycles `?variant=` through `variants`.
 * Lives on branch prototype/tree-no-rows-icon only; never merge it into main.
 */
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import { useCallback, useEffect, useSyncExternalStore } from 'react';

export interface PrototypeVariant {
  key: string;
  name: string;
}

/** The current `?variant=` key, else the first variant's. */
const CHANGE = 'prototype-variant-change';

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE, onChange);
  window.addEventListener('popstate', onChange);
  return () => {
    window.removeEventListener(CHANGE, onChange);
    window.removeEventListener('popstate', onChange);
  };
}

const read = () => new URLSearchParams(window.location.search).get('variant');

/** Read straight from the URL (no router), so it works in components rendered without one. */
export function usePrototypeVariant(variants: readonly PrototypeVariant[]): string {
  const key = useSyncExternalStore(subscribe, read);
  return variants.some((v) => v.key === key) ? key! : variants[0]!.key;
}

export function PrototypeSwitcher({ variants }: { variants: readonly PrototypeVariant[] }) {
  const current = usePrototypeVariant(variants);
  const index = variants.findIndex((v) => v.key === current);
  const go = useCallback(
    (step: number) => {
      const next = variants[(index + step + variants.length) % variants.length]!;
      const url = new URL(window.location.href);
      url.searchParams.set('variant', next.key);
      window.history.replaceState(window.history.state, '', url);
      window.dispatchEvent(new Event(CHANGE));
    },
    [index, variants],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const t = e.target as HTMLElement | null;
      // Arrows inside the grid move its focused cell; leave them alone there.
      if (t?.closest('input, textarea, [contenteditable="true"], .ag-root-wrapper')) return;
      e.preventDefault();
      go(e.key === 'ArrowLeft' ? -1 : 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);
  if (!import.meta.env.DEV) return null;
  const v = variants[index]!;
  return (
    <Box
      sx={{
        position: 'fixed',
        // Top centre, in the app bar's empty middle: the bottom centre has the app's snackbars,
        // and the bottom corners cover the grid's status bar.
        top: 8,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 2000,
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        px: 0.5,
        py: 0.25,
        borderRadius: 999,
        bgcolor: 'grey.900',
        color: 'common.white',
        boxShadow: 8,
        fontFamily: 'monospace',
        fontSize: 13,
        border: 2,
        borderStyle: 'dashed',
        borderColor: 'secondary.main',
      }}
    >
      <IconButton
        size="small"
        sx={{ color: 'common.white' }}
        onClick={() => go(-1)}
        aria-label="Previous variant"
      >
        <ChevronLeftIcon />
      </IconButton>
      <span>
        PROTOTYPE {v.key} ({v.name})
      </span>
      <IconButton
        size="small"
        sx={{ color: 'common.white' }}
        onClick={() => go(1)}
        aria-label="Next variant"
      >
        <ChevronRightIcon />
      </IconButton>
    </Box>
  );
}
