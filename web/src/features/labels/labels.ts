import { UNCONFIGURED_LABEL_COLOUR } from '../../app/theme';
import type { InstanceLabel, LabelColour, LabelSymbol } from '../../lib/api';

/** How a stored label key is drawn. */
export interface ShownLabel {
  key: string;
  name: string;
  colour: LabelColour;
  symbol: LabelSymbol | null;
}

/**
 * The instance's label for `key`. A key no longer configured shows grey as its bare key, with no
 * symbol.
 */
export function shownLabel(key: string, labels: readonly InstanceLabel[]): ShownLabel {
  const label = labels.find((l) => l.key === key);
  if (!label) return { key, name: key, colour: UNCONFIGURED_LABEL_COLOUR, symbol: null };
  return { key, name: label.name, colour: label.colour, symbol: label.symbol ?? null };
}
