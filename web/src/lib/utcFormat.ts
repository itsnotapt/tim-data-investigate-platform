const pad2 = (n: number): string => String(n).padStart(2, '0');

/** `YYYY-MM-DD` in UTC. */
export const formatUtcDate = (d: Date): string =>
  `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;

/** `HH:MM` in UTC. */
export const formatUtcTime = (d: Date): string =>
  `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;

/** `YYYY-MM-DD HH:MM UTC`, from an ISO timestamp. */
export const formatUtcDateTime = (iso: string): string => {
  const d = new Date(iso);
  return `${formatUtcDate(d)} ${formatUtcTime(d)} UTC`;
};
