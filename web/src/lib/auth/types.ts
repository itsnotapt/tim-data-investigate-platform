export interface AuthAccount {
  /** Entra object id (stable user id). */
  id: string;
  name: string;
  tenantId: string;
}

/** The single auth surface for the app. */
export interface AuthClient {
  /** The signed-in account, or `null` when signed out. */
  getAccount(): Promise<AuthAccount | null>;
  /** Access token for `scopes`. Rejects when not signed in. */
  acquireToken(scopes: string[]): Promise<string>;
  /** Resolves `null` when the stub has no analyst chosen yet. */
  login(): Promise<AuthAccount | null>;
  logout(): Promise<void>;
  /** Stub sign-in only: signs in as the analyst `name` (a name or email) and remembers them. */
  signInAs?(name: string): Promise<AuthAccount>;
}
