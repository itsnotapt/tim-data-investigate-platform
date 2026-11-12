// PROTOTYPE: throwaway variant switcher for UI prototypes. Not for main.
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { useEffect } from 'react';
import { useSearchParams } from 'react-router';

export interface PrototypeVariant {
  key: string;
  name: string;
}

/** The `?variant=` key, or the first variant's. */
// eslint-disable-next-line react-refresh/only-export-components -- prototype
export function usePrototypeVariant(variants: PrototypeVariant[]): string {
  const [params] = useSearchParams();
  const key = params.get('variant');
  return variants.some((v) => v.key === key) ? key! : (variants[0]?.key ?? '');
}

const typing = (el: Element | null) =>
  el instanceof HTMLInputElement ||
  el instanceof HTMLTextAreaElement ||
  (el instanceof HTMLElement && (el.isContentEditable || el.closest('.ag-root-wrapper') !== null));

/** A floating bar at the bottom centre: ← variant label →, and the arrow keys cycle too. */
export function PrototypeSwitcher({
  title,
  variants,
}: {
  title: string;
  variants: PrototypeVariant[];
}) {
  const [params, setParams] = useSearchParams();
  const current = usePrototypeVariant(variants);
  const index = variants.findIndex((v) => v.key === current);

  const go = (step: number) => {
    const next = variants[(index + step + variants.length) % variants.length];
    const p = new URLSearchParams(params);
    if (next) p.set('variant', next.key);
    setParams(p, { replace: true });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(document.activeElement) || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (import.meta.env.PROD) return null;
  return (
    <Paper
      elevation={8}
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
        borderRadius: 999,
        bgcolor: 'common.black',
        color: 'warning.light',
        border: '2px dashed',
        borderColor: 'warning.light',
      }}
    >
      <IconButton
        size="small"
        sx={{ color: 'inherit' }}
        aria-label="Previous variant"
        onClick={() => go(-1)}
      >
        <ChevronLeftIcon />
      </IconButton>
      <Typography variant="body2" sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
        {title} · {current} ({variants[index]?.name})
      </Typography>
      <IconButton
        size="small"
        sx={{ color: 'inherit' }}
        aria-label="Next variant"
        onClick={() => go(1)}
      >
        <ChevronRightIcon />
      </IconButton>
    </Paper>
  );
}
