import type { Tab, TitleInput } from '../tabs';
import { isUnset } from './paramValues';
import { queryParameters } from './queryParameters';

/** A value as a tab's title shows it: text as it is, anything else as JSON. */
const text = (value: unknown): string =>
  typeof value === 'string' ? value : JSON.stringify(value);

/** An input's value in a title: a list as up to two values, then how many more. */
function titleValue(value: unknown): string {
  if (!Array.isArray(value)) return text(value);
  const shown = value.slice(0, 2).map(text).join(', ');
  return value.length > 2 ? `${shown} +${value.length - 2}` : shown;
}

/** The value of `input` in `params`; a query parameter's is in the `parameters` param. */
const inputValue = (input: TitleInput, params: Record<string, unknown>): unknown =>
  input.source === 'param'
    ? params[input.name]
    : queryParameters(params.parameters).find((e) => e.name === input.name)?.value;

/**
 * The title a tab shows. Until it has run, its stored title. A preset tab's is its stored title,
 * the preset's name, then the values its latest run had for the inputs it shows in its title,
 * leaving out those unset. Any other tab's is its latest run's title.
 */
export function tabTitle(tab: Tab): string {
  const { titleInputs } = tab.params;
  const { runParams, runTitle } = tab.state;
  if (titleInputs) {
    if (!runParams) return tab.title;
    const values = titleInputs.map((i) => inputValue(i, runParams)).filter((v) => !isUnset(v));
    return [tab.title, ...values.map(titleValue)].join(' ');
  }
  return runTitle ?? tab.title;
}
