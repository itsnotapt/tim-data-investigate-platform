import type { CatalogueAction, CatalogueParam, PresetInput } from '../../lib/api';
import { stringifyJson } from '../../lib/json';
import { parseParamText } from './paramValues';

/** An input of a preset that is a query parameter: a name in its query, with a type. */
export type QueryParameterInput = Extract<PresetInput, { source: 'queryParameter' }>;

export type QueryParameterType = QueryParameterInput['type'];

/** The types a query parameter can be declared with, in the order the Save… dialog offers them. */
export const QUERY_PARAMETER_TYPES: readonly QueryParameterType[] = [
  'string',
  'long',
  'real',
  'bool',
  'datetime',
  'timespan',
  'dynamic',
];

/** One entry of the `parameters` param: a query parameter and its value. */
export interface QueryParameter {
  name: string;
  type: QueryParameterType;
  value: unknown;
}

/** Whether `param` is the one that carries query parameters: a `json` param named `parameters`. */
export const isParametersParam = (param: CatalogueParam): boolean =>
  param.name === 'parameters' && param.kind === 'json';

/**
 * Whether an action with `params` binds its query parameters by position, `:1` the first: its
 * connection is a Snowflake one.
 */
export const bindsByPosition = (params: readonly CatalogueParam[]): boolean =>
  params.some((p) => p.name === 'connection' && p.connectionType === 'snowflake');

/** A query parameter's place in the list: `:N` when bound by position, otherwise `N`. */
export const positionLabel = (index: number, bound: boolean): string =>
  bound ? `:${index + 1}` : `${index + 1}`;

/** The types the action's query parameters can be declared with: SQL has no `timespan`. */
export const queryParameterTypes = (action: CatalogueAction): readonly QueryParameterType[] =>
  bindsByPosition(action.params)
    ? QUERY_PARAMETER_TYPES.filter((type) => type !== 'timespan')
    : QUERY_PARAMETER_TYPES;

/** Whether the action takes query parameters. */
export const takesQueryParameters = (action: CatalogueAction): boolean =>
  action.params.some(isParametersParam);

const PILL_PREFIX = 'parameters.';

/** The name of a query parameter's pill, which no param name can be. */
export const pillName = (name: string): string => `${PILL_PREFIX}${name}`;

const isQueryParameter = (entry: unknown): entry is QueryParameter =>
  typeof entry === 'object' &&
  entry !== null &&
  typeof (entry as QueryParameter).name === 'string' &&
  QUERY_PARAMETER_TYPES.includes((entry as QueryParameter).type);

/** The query parameters of a `parameters` value; anything that isn't one is skipped. */
export const queryParameters = (value: unknown): QueryParameter[] =>
  Array.isArray(value) ? value.filter(isQueryParameter) : [];

/** The `parameters` entries of a preset's query parameters: fixed values, and `null` for the rest. */
export const presetQueryParameters = (inputs: readonly PresetInput[]): QueryParameter[] =>
  inputs.flatMap((i) =>
    i.source === 'queryParameter'
      ? [{ name: i.name, type: i.type, value: i.fixed ? i.value : null }]
      : [],
  );

/**
 * The tab's values with the query parameters of a preset just saved from it: a fixed one's value,
 * and for a From row one the value the tab had for it, if any.
 */
export function withPresetQueryParameters(
  values: Record<string, unknown>,
  inputs: readonly PresetInput[],
): Record<string, unknown> {
  const had = new Map(queryParameters(values.parameters).map((e) => [`${e.name}:${e.type}`, e]));
  const entries = presetQueryParameters(inputs).map((entry) =>
    entry.value === null ? (had.get(`${entry.name}:${entry.type}`) ?? entry) : entry,
  );
  const next: Record<string, unknown> = { ...values, parameters: entries };
  if (entries.length === 0) delete next.parameters;
  return next;
}

/** How a query parameter's pill edits its value: `dynamic` is a list of values. */
const PILL_KINDS: Record<QueryParameterType, Pick<CatalogueParam, 'kind' | 'many'>> = {
  string: { kind: 'string', many: false },
  long: { kind: 'number', many: false },
  real: { kind: 'number', many: false },
  bool: { kind: 'boolean', many: false },
  datetime: { kind: 'datetime', many: false },
  timespan: { kind: 'timespan', many: false },
  dynamic: { kind: 'string', many: true },
};

/**
 * The tab's pills: each param but `parameters`, which gives one pill per query parameter in its
 * place, with the values keyed by pill name. A query parameter bound by position says which.
 */
export function pills(
  params: readonly CatalogueParam[],
  values: Record<string, unknown>,
): { params: CatalogueParam[]; values: Record<string, unknown> } {
  const entries = queryParameters(values.parameters);
  const pillValues = { ...values };
  const bound = bindsByPosition(params);
  const position = (i: number) => (bound ? ` ${positionLabel(i, true)}` : '');
  for (const entry of entries) pillValues[pillName(entry.name)] = entry.value;
  return {
    params: params.flatMap((p) =>
      isParametersParam(p)
        ? entries.map((entry, i): CatalogueParam => ({
            name: pillName(entry.name),
            title: entry.name,
            required: true,
            ...PILL_KINDS[entry.type],
            help: `Query parameter${position(i)}, ${entry.type}`,
          }))
        : [p],
    ),
    values: pillValues,
  };
}

/**
 * The tab's values with the pill `name` set to `value`: a query parameter's pill sets its entry,
 * `undefined` to `null`; any other pill is its param, which `undefined` unsets.
 */
export function setPill(
  values: Record<string, unknown>,
  name: string,
  value: unknown,
): Record<string, unknown> {
  if (name.startsWith(PILL_PREFIX)) {
    const entries = queryParameters(values.parameters).map((entry) =>
      pillName(entry.name) === name ? { ...entry, value: value ?? null } : entry,
    );
    return { ...values, parameters: entries };
  }
  const next = { ...values };
  if (value === undefined) delete next[name];
  else next[name] = value;
  return next;
}

/** A query parameter's value as text: JSON for `dynamic`, empty when unset. */
export function valueText(type: QueryParameterType, value: unknown): string {
  if (value === null || value === undefined) return '';
  return type === 'dynamic' || typeof value === 'object'
    ? stringifyJson(value)
    : `${value as string | number | boolean}`;
}

/** A query parameter's value typed as text, or why it isn't one of its type; empty is unset. */
export function parseValue(
  type: QueryParameterType,
  text: string,
): { value?: unknown; error?: string } {
  const trimmed = text.trim();
  if (type === 'bool' && trimmed !== '') {
    return trimmed === 'true' || trimmed === 'false'
      ? { value: trimmed === 'true' }
      : { error: 'Must be true or false' };
  }
  const kind = type === 'dynamic' ? 'json' : PILL_KINDS[type].kind;
  return parseParamText(kind, text);
}
