import { stillNeeded } from '../action-tab/model';
import type { Tab } from '../tabs';

export type NodeStatus = 'executing' | 'error' | 'needsInput' | 'noRows' | 'results' | 'draft';

/** Draft: never run, not running, no error. */
const isDraft = (t: Tab): boolean =>
  t.results === null && !t.status.executing && t.status.error === null;

/** New: has results that were not visited yet, no error. */
export const isNew = (t: Tab): boolean =>
  t.results !== null && !t.visited && t.status.error === null;

/**
 * Icon precedence: spinner, error, needs input (the tab's pivot waits for a param), badge (has row
 * count, `0` when the run succeeded with no rows), plain folder.
 */
export function nodeStatus(t: Tab): NodeStatus {
  if (t.status.executing) return 'executing';
  if (t.status.error) return 'error';
  if (stillNeeded(t).length > 0) return 'needsInput';
  if (t.results?.rowCount === 0) return 'noRows';
  if (t.results && t.results.rowCount > 0) return 'results';
  return 'draft';
}

export const labelPrefix = (t: Tab): string => (isDraft(t) ? '[draft] ' : isNew(t) ? '[new] ' : '');

export const badgeText = (rowCount: number): string => (rowCount > 9 ? '9+' : String(rowCount));

export type BadgeTone = 'default' | 'info';
export const badgeTone = (t: Tab): BadgeTone => (t.visited ? 'default' : 'info');
