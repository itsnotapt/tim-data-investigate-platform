import { useContext } from 'react';
import { AuthContext, type UseAuth } from './authContext';

export type { UseAuth } from './authContext';

export function useAuth(): UseAuth {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/**
 * The signed-in analyst's name, as the API names them (a preset's `owner`), or `''` when signed
 * out or outside an `<AuthProvider>`.
 */
export function useAccountName(): string {
  return useContext(AuthContext)?.account?.name ?? '';
}
