import Box from '@mui/material/Box';
import { useContext, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ActionBarSlotContext } from './actionBarSlotContext';

/** Holds the action bar's slot for `ActionBarSlot` and `InActionBar` below it. */
export function ActionBarSlotProvider({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const value = useMemo(() => ({ slot, setSlot }), [slot]);
  return <ActionBarSlotContext value={value}>{children}</ActionBarSlotContext>;
}

/** The place in the action bar that a page's `InActionBar` fills; it takes the free width. */
export function ActionBarSlot() {
  const setSlot = useContext(ActionBarSlotContext)?.setSlot;
  return (
    <Box
      ref={setSlot}
      sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1, minWidth: 0 }}
    />
  );
}

/** Renders `children` in the action bar's slot; nothing without one. */
export function InActionBar({ children }: { children: ReactNode }) {
  const slot = useContext(ActionBarSlotContext)?.slot;
  return slot ? createPortal(children, slot) : null;
}
