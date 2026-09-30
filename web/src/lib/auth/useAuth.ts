import { useContext } from 'react';
import { AuthContext, type UseAuth } from './authContext';

export type { AuthStatus, UseAuth } from './authContext';

export function useAuth(): UseAuth {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
