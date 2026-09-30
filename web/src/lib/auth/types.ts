export interface AuthAccount {
  /** Entra object id (stable user id). */
  id: string;
  name: string;
  tenantId: string;
}

/** The single auth surface for the app (RULES.md section 6). MSAL implements it in P3-01. */
export interface AuthClient {
  /** The signed-in account, or `null` when signed out. */
  getAccount(): Promise<AuthAccount | null>;
  /** Access token for `scopes`. Rejects when not signed in. */
  acquireToken(scopes: string[]): Promise<string>;
  login(): Promise<AuthAccount>;
  logout(): Promise<void>;
}
