/** Visited tabs kept mounted (capped to bound memory). */
export const MAX_MOUNTED_TABS = 100;

/** Moves `uuid` to the most-recent end, evicting the least recently visited beyond `max`. */
export function touchLru(list: readonly string[], uuid: string, max = MAX_MOUNTED_TABS): string[] {
  const next = [...list.filter((id) => id !== uuid), uuid];
  return next.length > max ? next.slice(next.length - max) : next;
}
