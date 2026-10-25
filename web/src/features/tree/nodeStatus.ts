import { stillMissing } from '../action-tab/paramValues';
import type { Tab } from '../tabs';

export type NodeStatus = 'executing' | 'error' | 'needsInput' | 'noRows' | 'results' | 'draft';

/** Draft: never run, not running, no error. */
const isDraft = (t: Tab): boolean =>
  t.state.rowCount === null && !t.state.isExecuting && t.state.error === null;

/** New: has results that were not visited yet, no error. */
export const isNew = (t: Tab): boolean =>
  t.state.rowCount !== null && !t.state.isVisited && t.state.error === null;

/**
 * Icon precedence: spinner, error, needs input (the tab's pivot waits for a param), ringed 0 (the
 * run succeeded with no rows), badge (has row count), plain folder.
 */
export function nodeStatus(t: Tab): NodeStatus {
  if (t.state.isExecuting) return 'executing';
  if (t.state.error) return 'error';
  if (stillMissing(t.state.pivotMissing, t.params.params).length > 0) return 'needsInput';
  if (t.state.rowCount === 0) return 'noRows';
  if (t.state.rowCount !== null && t.state.rowCount > 0) return 'results';
  return 'draft';
}

export const labelPrefix = (t: Tab): string => (isDraft(t) ? '[draft] ' : isNew(t) ? '[new] ' : '');

export const badgeText = (rowCount: number): string => (rowCount > 9 ? '9+' : String(rowCount));

export type BadgeTone = 'default' | 'info';
export const badgeTone = (t: Tab): BadgeTone => (t.state.isVisited ? 'default' : 'info');
