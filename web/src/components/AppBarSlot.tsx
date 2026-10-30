import Box from '@mui/material/Box';
import { useContext, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AppBarSlotContext } from './appBarSlotContext';

/** Holds the app bar's slot for `AppBarSlot` and `InAppBar` below it. */
export function AppBarSlotProvider({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const value = useMemo(() => ({ slot, setSlot }), [slot]);
  return <AppBarSlotContext value={value}>{children}</AppBarSlotContext>;
}

/** The place in the app bar that a page's `InAppBar` fills; it takes the free width. */
export function AppBarSlot() {
  const setSlot = useContext(AppBarSlotContext)?.setSlot;
  return <Box ref={setSlot} sx={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }} />;
}

/** Renders `children` in the app bar's slot; nothing without one. */
export function InAppBar({ children }: { children: ReactNode }) {
  const slot = useContext(AppBarSlotContext)?.slot;
  return slot ? createPortal(children, slot) : null;
}
