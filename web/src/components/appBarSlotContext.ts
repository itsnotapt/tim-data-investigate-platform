import { createContext } from 'react';

/** The app bar's slot element, once mounted, and the setter `AppBarSlot` mounts it with. */
export interface AppBarSlotValue {
  slot: HTMLElement | null;
  setSlot: (el: HTMLElement | null) => void;
}

export const AppBarSlotContext = createContext<AppBarSlotValue | null>(null);
