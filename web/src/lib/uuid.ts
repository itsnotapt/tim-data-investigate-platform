/**
 * RFC 4122 v4 UUID. Replaces legacy `generateUuidv4` (frontend/src/helpers/utils.js:5 (removed in P5-12)), a
 * hand-rolled `crypto.getRandomValues` template; `crypto.randomUUID` yields the same format.
 */
export function generateUuid(): string {
  return crypto.randomUUID();
}
