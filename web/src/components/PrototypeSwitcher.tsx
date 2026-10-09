// PROTOTYPE: floating variant switcher for throwaway UI prototypes. Dev builds only.
import { useEffect, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';

export function usePrototypeVariant(keys: readonly string[]): string {
  const [params] = useSearchParams();
  const v = params.get('variant');
  return v && keys.includes(v) ? v : keys[0]!;
}

interface Props {
  variants: readonly { key: string; name: string }[];
  /** Live state readout, re-rendered on every change. */
  state?: ReactNode;
}

export function PrototypeSwitcher({ variants, state }: Props) {
  const [params, setParams] = useSearchParams();
  const keys = variants.map((v) => v.key);
  const current = usePrototypeVariant(keys);
  const i = keys.indexOf(current);
  const go = (delta: number) => {
    const next = new URLSearchParams(params);
    next.set('variant', keys[(i + delta + keys.length) % keys.length]!);
    setParams(next, { replace: true });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      const t = e.target as HTMLElement | null;
      // Leave arrow keys to editors, open menus and grids.
      if (t?.closest('input, textarea, [contenteditable], [role="menu"], [role="grid"]')) return;
      go(e.key === 'ArrowLeft' ? -1 : 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!import.meta.env.DEV) return null;
  const btn = {
    background: 'none',
    border: 0,
    color: 'inherit',
    font: 'inherit',
    cursor: 'pointer',
    padding: '0 8px',
  };
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 2000,
        background: '#ff0',
        color: '#000',
        border: '2px solid #000',
        borderRadius: 999,
        padding: '6px 12px',
        boxShadow: '0 4px 12px rgba(0,0,0,.4)',
        font: '13px/1.3 monospace',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <button type="button" style={btn} aria-label="Previous variant" onClick={() => go(-1)}>
        ◀
      </button>
      <strong>
        {current} ({variants[i]?.name})
      </strong>
      <button type="button" style={btn} aria-label="Next variant" onClick={() => go(1)}>
        ▶
      </button>
      {state && <span style={{ borderLeft: '1px solid #000', paddingLeft: 8 }}>{state}</span>}
    </div>
  );
}
