import { isApiError } from '../../lib/api';

/**
 * The server's reason for rejecting a cluster (`errors.cluster` of a `cluster-not-allowed`
 * problem), or null when `e` is not such an error or carries no reason.
 */
export function clusterRejectionReason(e: unknown): string | null {
  if (!isApiError(e)) return null;
  const reason = e.errors?.cluster?.filter((r) => r.trim() !== '').join(' ');
  return reason ? reason : null;
}

/** `e` itself, or an `Error` carrying the cluster rejection reason when the server gave one. */
export function withClusterReason(e: unknown): unknown {
  const reason = clusterRejectionReason(e);
  return reason === null ? e : new Error(reason, { cause: e });
}
