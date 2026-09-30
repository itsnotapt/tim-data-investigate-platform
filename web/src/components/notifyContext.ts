import { createContext, type ReactNode } from 'react';

export interface NotifyOptions {
  message: string;
  /** Auto-hide delay in ms (legacy default 5000). */
  timeout?: number;
  icon?: ReactNode;
  /** Optional link button, opens in a new tab. */
  link?: string;
  linkText?: string;
}

export type Notify = (options: NotifyOptions | string) => void;

export const NotifyContext = createContext<Notify | null>(null);
