import type {
  CatalogueAction,
  CatalogueParam,
  Preset,
  PresetFields,
  PresetInput,
} from '../../lib/api';
import { isUnset, paramText } from '../action-tab/paramValues';
import { unnamedPlaceholders } from '../action-tab/titleTemplate';
import {
  isParametersParam,
  parseValue,
  queryParameters,
  valueText,
  type QueryParameterType,
} from '../action-tab/queryParameters';
import { kqlNames, nameError } from './queryParameterNames';

/** How one param that rows can fill is saved: its value fixed, or read from the clicked row. */
export interface InputMode {
  fixed: boolean;
  /** From row only: the columns to read, in order; none asks for the value when opened. */
  columns: string[];
}

/** One query parameter the Save… dialog declares, as typed. */
export interface QueryParameterForm {
  name: string;
  type: QueryParameterType;
  fixed: boolean;
  /** Fixed only: the value. */
  value: string;
  /** From row only: the columns to read, in order; none asks when opened. */
  columns: string[];
}

/** What the Save… dialog edits. */
export interface PresetForm {
  name: string;
  /** The folder in the New menu, a level each, the top level first; empty for the top level. */
  folder: string[];
  visibility: Preset['visibility'];
  /** By param name, for each param of the action with `fromColumns`. */
  modes: Record<string, InputMode>;
  /** For an action that takes query parameters, in the order they're declared. */
  queryParameters: QueryParameterForm[];
  /** The Tab title as typed; `null` until it is edited, while it is the default (`formTitle`). */
  title: string | null;
}

/** The params of `action` that rows can fill: those with `fromColumns`. */
export const rowParams = (action: CatalogueAction): CatalogueParam[] =>
  action.params.filter((p) => (p.fromColumns ?? []).length > 0);

/**
 * The form for saving `params` of `action`. From an existing preset, its name, folder, inputs and
 * title template; otherwise each set value is fixed and each unset one is read from all its
 * columns, or for a query parameter asked for when opened, and the Tab title is the default. A
 * copy of someone else's preset starts private.
 */
export function initialForm(
  action: CatalogueAction,
  params: Record<string, unknown>,
  source: Preset | undefined,
): PresetForm {
  const inputs = new Map((source?.inputs ?? []).map((i) => [i.name, i]));
  const modes = Object.fromEntries(
    rowParams(action).map((p): [string, InputMode] => {
      const input = inputs.get(p.name);
      const fixed = input ? input.fixed : !isUnset(params[p.name]);
      const columns = input && !input.fixed ? input.fromColumns : (p.fromColumns ?? []);
      return [p.name, { fixed, columns }];
    }),
  );
  return {
    name: source?.name ?? action.name,
    folder: source?.menuPath ?? action.menuPath,
    visibility: source?.owned ? source.visibility : 'private',
    modes,
    queryParameters: queryParameters(params.parameters).map((entry) => {
      const input = inputs.get(entry.name);
      const fixed = input?.source === 'queryParameter' ? input.fixed : !isUnset(entry.value);
      return {
        name: entry.name,
        type: entry.type,
        fixed,
        value: valueText(entry.type, entry.value),
        columns: input?.source === 'queryParameter' && !input.fixed ? input.fromColumns : [],
      };
    }),
    title: source?.title ?? null,
  };
}

/**
 * The Tab title of the form: as typed, or until it is edited, the name then a placeholder for each
 * From row input, in the action's order of params, with the query parameters in place of
 * `parameters`.
 */
export function formTitle(action: CatalogueAction, form: PresetForm): string {
  if (form.title !== null) return form.title;
  const fromRow = action.params.flatMap((p) => {
    if (isParametersParam(p)) {
      return form.queryParameters.filter((qp) => !qp.fixed && qp.name !== '').map((qp) => qp.name);
    }
    const mode = form.modes[p.name];
    return mode && !mode.fixed ? [p.name] : [];
  });
  return [form.name.trim(), ...fromRow.map((name) => `{${name}}`)].join(' ');
}

/**
 * The names a placeholder of the Tab title can hold besides `row.` and a column: the action's
 * params and the form's query parameters.
 */
export const titleNames = (action: CatalogueAction, form: PresetForm): Set<string> =>
  new Set([...action.params.map((p) => p.name), ...form.queryParameters.map((qp) => qp.name)]);

/**
 * What's wrong with the Tab title of the form, if anything: the placeholders that name neither a
 * param of the action, a query parameter of the form, nor `row.` and a column.
 */
export function titleError(action: CatalogueAction, form: PresetForm): string | undefined {
  const unnamed = unnamedPlaceholders(formTitle(action, form), titleNames(action, form));
  if (unnamed.length === 0) return undefined;
  const listed =
    unnamed.length === 1 ? unnamed[0] : `${unnamed.slice(0, -1).join(', ')} and ${unnamed.at(-1)}`;
  return `${listed} ${unnamed.length === 1 ? 'names' : 'name'} nothing`;
}

/**
 * The placeholders the Tab title suggests, each once, in order: the inputs, the action's other
 * params, the query parameters, then `row.` and each column the From row inputs read.
 */
export function titleSuggestions(action: CatalogueAction, form: PresetForm): string[] {
  const inputs = rowParams(action);
  const others = action.params.filter((p) => !inputs.includes(p) && !isParametersParam(p));
  const queryParameters = form.queryParameters.filter((qp) => qp.name !== '');
  const columns = [
    ...inputs.flatMap((p) => {
      const mode = form.modes[p.name];
      return mode && !mode.fixed ? mode.columns : [];
    }),
    ...queryParameters.flatMap((qp) => (qp.fixed ? [] : qp.columns)),
  ];
  return [
    ...new Set([
      ...[...inputs, ...others].map((p) => p.name),
      ...queryParameters.map((qp) => qp.name),
      ...columns.filter((column) => column !== '').map((column) => `row.${column}`),
    ]),
  ];
}

/**
 * An example Tab title for the form: its name, then its first two inputs as placeholders, or when
 * it has none the action's first two other params: "e.g. Sign-ins for {users} on {host}".
 */
export function titleExample(action: CatalogueAction, form: PresetForm): string {
  const inputs = [
    ...rowParams(action).map((p) => p.name),
    ...form.queryParameters.map((qp) => qp.name).filter((name) => name !== ''),
  ];
  const others = action.params
    .filter((p) => (p.fromColumns ?? []).length === 0 && !isParametersParam(p))
    .map((p) => p.name);
  const [first, second] = inputs.length > 0 ? inputs : others;
  return [
    `e.g. ${form.name.trim() || action.name}`,
    first !== undefined && `for {${first}}`,
    second !== undefined && `on {${second}}`,
  ]
    .filter(Boolean)
    .join(' ');
}

/** What's wrong with a query parameter of the form, by field; empty when nothing is. */
export function queryParameterErrors(
  form: PresetForm,
  index: number,
): { name?: string; value?: string } {
  const qp = form.queryParameters[index];
  if (!qp) return {};
  const taken = form.queryParameters.slice(0, index).some((other) => other.name === qp.name);
  const parsed = qp.fixed ? parseValue(qp.type, qp.value) : {};
  return {
    name: nameError(qp.name) ?? (taken ? 'Already a query parameter' : undefined),
    value:
      parsed.error ??
      (qp.fixed && parsed.value === undefined ? 'Needs a value, or read it From row' : undefined),
  };
}

/**
 * Whether the form can be saved: it has a name, and a Tab title that names only what it can, and
 * no query parameter has an error.
 */
export const canSave = (action: CatalogueAction, form: PresetForm): boolean =>
  form.name.trim() !== '' &&
  formTitle(action, form).trim() !== '' &&
  titleError(action, form) === undefined &&
  form.queryParameters.every((_, i) =>
    Object.values(queryParameterErrors(form, i)).every((e) => !e),
  );

/** The names in the action's query that no query parameter of the form has yet. */
export function suggestedNames(
  action: CatalogueAction,
  params: Record<string, unknown>,
  form: PresetForm,
): string[] {
  const kql = action.params.find((p) => p.kind === 'kql');
  const text = kql && typeof params[kql.name] === 'string' ? (params[kql.name] as string) : '';
  const taken = new Set(form.queryParameters.map((qp) => qp.name));
  return kqlNames(text).filter((name) => !taken.has(name));
}

/** The query parameter inputs the form saves. */
const queryParameterInputs = (form: PresetForm): PresetInput[] =>
  form.queryParameters.map(({ name, type, fixed, value, columns }) =>
    fixed
      ? { name, source: 'queryParameter', type, fixed, value: parseValue(type, value).value }
      : { name, source: 'queryParameter', type, fixed, fromColumns: columns },
  );

/**
 * The preset the form saves, with `idColumn` and the form's Tab title: unset values are left out,
 * From row inputs keep no value, and query parameters are inputs in place of the `parameters`
 * param.
 */
export function formFields(
  action: CatalogueAction,
  params: Record<string, unknown>,
  form: PresetForm,
  idColumn: string | null = null,
): PresetFields {
  const inputs: PresetInput[] = [];
  const kept: Record<string, unknown> = {};
  for (const p of action.params) {
    const mode = form.modes[p.name];
    const value = params[p.name];
    if (isParametersParam(p)) {
      inputs.push(...queryParameterInputs(form));
    } else if (mode && !mode.fixed) {
      inputs.push({ name: p.name, source: 'param', fixed: false, fromColumns: mode.columns });
    } else if (isUnset(value)) {
      continue;
    } else if (mode) {
      inputs.push({ name: p.name, source: 'param', fixed: true, value });
    } else {
      kept[p.name] = value;
    }
  }
  return {
    name: form.name.trim(),
    menuPath: form.folder,
    visibility: form.visibility,
    action: action.key,
    params: kept,
    inputs,
    idColumn,
    title: formTitle(action, form),
  };
}

/**
 * The params of the action saved as they are, set and neither an input nor the query, each as
 * its name and its value in one line.
 */
export const keptParams = (
  action: CatalogueAction,
  params: Record<string, unknown>,
): { name: string; text: string }[] =>
  action.params
    .filter(
      (p) =>
        (p.fromColumns ?? []).length === 0 &&
        !isParametersParam(p) &&
        !isQueryParam(p) &&
        !isUnset(params[p.name]),
    )
    .map((p) => ({ name: p.name, text: paramText(params[p.name]) }));

const isQueryParam = (p: CatalogueParam) => p.kind === 'kql' || p.kind === 'sql';

/** The action's query in `params`: its KQL or SQL, `''` when unset; `undefined` when it has none. */
export function queryText(
  action: CatalogueAction,
  params: Record<string, unknown>,
): string | undefined {
  const p = action.params.find(isQueryParam);
  if (!p) return undefined;
  const value = params[p.name];
  return typeof value === 'string' ? value : '';
}

/**
 * The folders one level below `at` among `paths`, each once, sorted: the options for the next
 * level of a folder in the New menu.
 */
export function subfolders(paths: readonly (readonly string[])[], at: readonly string[]): string[] {
  const names = new Set<string>();
  for (const path of paths) {
    const next = path[at.length];
    if (next !== undefined && at.every((level, i) => path[i] === level)) names.add(next);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

/** A value in one line, or when it is unset the placeholder for the param's type. */
export const valueOrType = (param: CatalogueParam, value: unknown): string =>
  isUnset(value) ? `<${param.kind}>` : paramText(value);

/** A preset's fields, to send it back changed or as a copy. */
export const presetFields = ({
  name,
  menuPath,
  visibility,
  action,
  params,
  inputs,
  title,
}: Preset): PresetFields => ({
  name,
  menuPath,
  visibility,
  action,
  params,
  inputs,
  title,
});
