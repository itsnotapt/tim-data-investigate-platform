import { createContext } from 'react';
import type { AuthAccount } from './types';

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn' | 'error';

export interface UseAuth {
  account: AuthAccount | null;
  status: AuthStatus;
  error: Error | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  /** Access token for `scopes` (defaults to the API scope). */
  getToken: (scopes?: string[]) => Promise<string>;
}

export const AuthContext = createContext<UseAuth | null>(null);
