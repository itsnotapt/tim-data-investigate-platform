import { MsalProvider } from '@azure/msal-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AuthContext, type AuthStatus, type UseAuth } from './authContext';
import { toAuthError } from './errors';
import { apiScopes, type MsalAuthClient } from './msalAuth';
import type { AuthAccount, AuthClient } from './types';

interface Props {
  client: AuthClient;
  /** Default scopes for `getToken()`. Defaults to `api://<clientId>/user_impersonation` when known. */
  scopes?: string[];
  children: ReactNode;
}

interface State {
  status: AuthStatus;
  account: AuthAccount | null;
  error: Error | null;
}

const isMsal = (c: AuthClient): c is MsalAuthClient => 'msal' in c;

/** Holds the auth state for the app. Wraps `MsalProvider` when the client is MSAL-backed. */
export function AuthProvider({ client, scopes, children }: Props) {
  const [state, setState] = useState<State>({ status: 'loading', account: null, error: null });

  useEffect(() => {
    let cancelled = false;
    client.getAccount().then(
      (account) => {
        if (!cancelled)
          setState({ status: account ? 'signedIn' : 'signedOut', account, error: null });
      },
      (e: unknown) => {
        if (!cancelled) setState({ status: 'error', account: null, error: toAuthError(e) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client]);

  const login = useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading', error: null }));
    try {
      const account = await client.login();
      setState({ status: 'signedIn', account, error: null });
    } catch (e) {
      // Stay retryable: the error is shown, and calling login() again starts a fresh attempt.
      setState({ status: 'error', account: null, error: toAuthError(e) });
    }
  }, [client]);

  const logout = useCallback(async () => {
    try {
      await client.logout();
      setState({ status: 'signedOut', account: null, error: null });
    } catch (e) {
      setState((s) => ({ ...s, status: 'error', error: toAuthError(e) }));
    }
  }, [client]);

  const defaultScopes = scopes ?? (isMsal(client) ? apiScopes(clientIdOf(client)) : []);
  const scopeKey = defaultScopes.join(' ');
  const getToken = useCallback(
    (s?: string[]) => client.acquireToken(s ?? (scopeKey ? scopeKey.split(' ') : [])),
    [client, scopeKey],
  );

  const value = useMemo<UseAuth>(
    () => ({ ...state, login, logout, getToken }),
    [state, login, logout, getToken],
  );

  const tree = <AuthContext value={value}>{children}</AuthContext>;
  return isMsal(client) ? <MsalProvider instance={client.msal}>{tree}</MsalProvider> : tree;
}

function clientIdOf(c: MsalAuthClient): string {
  return c.msal.getConfiguration().auth.clientId;
}
