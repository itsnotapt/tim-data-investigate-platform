export type AuthErrorCode =
  'interaction_in_progress' | 'popup_blocked' | 'cancelled' | 'not_signed_in' | 'unknown';

const POPUP_HINT = 'Check that your browser allows pop-up windows for this site.';

const MESSAGES: Record<AuthErrorCode, string> = {
  interaction_in_progress:
    'Authentication is in an abnormal state. Consider clearing the session and cookies to resolve this.',
  popup_blocked: `The sign-in window could not be opened. ${POPUP_HINT}`,
  cancelled: `Sign-in was cancelled. ${POPUP_HINT}`,
  not_signed_in: 'You must sign in to access TIM.',
  unknown: 'Sign-in failed.',
};

/** Typed sign-in/token failure. Always retryable: no client state is left stuck (BUG-22). */
export class AuthClientError extends Error {
  readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode, cause?: unknown, message?: string) {
    super(message ?? MESSAGES[code], cause === undefined ? undefined : { cause });
    this.name = 'AuthClientError';
    this.code = code;
  }
}

/** Maps any thrown value (MSAL errors carry `errorCode`) to an `AuthClientError`. */
export function toAuthError(e: unknown): AuthClientError {
  if (e instanceof AuthClientError) return e;
  const errorCode = (e as { errorCode?: unknown } | null)?.errorCode;
  switch (errorCode) {
    case 'interaction_in_progress':
    case 'interaction_in_progress_cancelled':
      return new AuthClientError('interaction_in_progress', e);
    case 'user_cancelled':
      return new AuthClientError('cancelled', e);
    case 'popup_window_error':
    case 'empty_window_error':
      return new AuthClientError('popup_blocked', e);
    default: {
      const detail = e instanceof Error ? e.message : String(e);
      return new AuthClientError('unknown', e, `Sign-in failed: ${detail}`);
    }
  }
}
