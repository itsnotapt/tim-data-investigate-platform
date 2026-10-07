import { relativeRange, type RelativeTimeRange } from './timeRange';

/**
 * Quick-select presets, in menu order.
 * Labels are produced by `timeRangeLabel`, e.g. "Last 15 minutes", "Last 1 hours".
 */
export const TIME_RANGE_PRESETS: readonly RelativeTimeRange[] = [
  relativeRange({ amount: 15, unit: 'minutes' }),
  relativeRange({ amount: 30, unit: 'minutes' }),
  relativeRange({ amount: 1, unit: 'hours' }),
  relativeRange({ amount: 24, unit: 'hours' }),
  relativeRange({ amount: 7, unit: 'days' }),
  relativeRange({ amount: 30, unit: 'days' }),
  relativeRange({ amount: 90, unit: 'days' }),
];

/** Default: emitted on mount, "Last 15 minutes". */
export const DEFAULT_TIME_RANGE: RelativeTimeRange = TIME_RANGE_PRESETS[0] as RelativeTimeRange;
