import { createContext } from 'react';

/** The action bar's slot element, once mounted, and the setter `ActionBarSlot` mounts it with. */
export interface ActionBarSlotValue {
  slot: HTMLElement | null;
  setSlot: (el: HTMLElement | null) => void;
}

export const ActionBarSlotContext = createContext<ActionBarSlotValue | null>(null);
