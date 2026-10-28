/** PROTOTYPE (#171), throwaway: the floating ‹ variant › bar. Dev builds only. */
import { useEffect } from 'react';
import { useSearchParams } from 'react-router';

export function PrototypeSwitcher<V extends string>({
  variants,
  names,
}: {
  variants: readonly V[];
  names: Record<V, string>;
}) {
  const [search, setSearch] = useSearchParams();
  const current = (variants.find((v) => v === search.get('variant')) ?? variants[0]) as V;
  const go = (step: number) => {
    const i = (variants.indexOf(current) + step + variants.length) % variants.length;
    const next = new URLSearchParams(search);
    next.set('variant', variants[i] ?? '');
    setSearch(next, { replace: true });
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, [contenteditable], .ag-root-wrapper')) return;
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  if (!import.meta.env.DEV) return null;
  const button = {
    all: 'unset',
    cursor: 'pointer',
    padding: '0 10px',
    fontSize: 18,
  } as const;
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 2000,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '6px 10px',
        borderRadius: 999,
        background: '#111',
        color: '#ff0',
        fontFamily: 'monospace',
        fontSize: 13,
        boxShadow: '0 4px 16px rgba(0,0,0,.4)',
      }}
    >
      <button style={button} onClick={() => go(-1)} aria-label="Previous variant">
        ‹
      </button>
      <span>{`PROTOTYPE #171 · ${current} (${names[current]})`}</span>
      <button style={button} onClick={() => go(1)} aria-label="Next variant">
        ›
      </button>
    </div>
  );
}
