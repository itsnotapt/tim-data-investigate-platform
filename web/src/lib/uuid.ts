/** RFC 4122 v4 UUID via `crypto.randomUUID`. */
export function generateUuid(): string {
  return crypto.randomUUID();
}
