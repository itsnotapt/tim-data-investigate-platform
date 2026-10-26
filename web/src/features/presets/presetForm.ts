import type {
  CatalogueAction,
  CatalogueParam,
  Preset,
  PresetFields,
  PresetInput,
} from '../../lib/api';
import { isUnset, paramText } from '../action-tab/paramValues';
import {
  bindsByPosition,
  isParametersParam,
  parseValue,
  positionLabel,
  queryParameters,
  valueText,
  type QueryParameterType,
} from '../action-tab/queryParameters';
import { declareStatement, kqlNames, nameError } from './queryParameterNames';

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
  /** From row only: the columns to read, in order, separated by commas; none asks when opened. */
  columns: string;
}

/** What the Save… dialog edits. */
export interface PresetForm {
  name: string;
  /** Folders, separated by `/`. */
  folder: string;
  visibility: Preset['visibility'];
  /** By param name, for each param of the action with `fromColumns`. */
  modes: Record<string, InputMode>;
  /** For an action that takes query parameters, in the order they're declared. */
  queryParameters: QueryParameterForm[];
}

/** The params of `action` that rows can fill: those with `fromColumns`. */
export const rowParams = (action: CatalogueAction): CatalogueParam[] =>
  action.params.filter((p) => (p.fromColumns ?? []).length > 0);

/**
 * The form for saving `params` of `action`. From an existing preset, its name, folder and inputs;
 * otherwise each set value is fixed and each unset one is read from all its columns, or for a
 * query parameter asked for when opened. A copy of someone else's preset starts private.
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
    folder: (source?.menuPath ?? action.menuPath).join(' / '),
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
        columns:
          input?.source === 'queryParameter' && !input.fixed ? input.fromColumns.join(', ') : '',
      };
    }),
  };
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

/** Whether the form can be saved: it has a name, and no query parameter has an error. */
export const canSave = (form: PresetForm): boolean =>
  form.name.trim() !== '' &&
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

const columnList = (columns: string): string[] =>
  columns
    .split(',')
    .map((c) => c.trim())
    .filter((c) => c !== '');

/** The query parameter inputs the form saves. */
const queryParameterInputs = (form: PresetForm): PresetInput[] =>
  form.queryParameters.map(({ name, type, fixed, value, columns }) =>
    fixed
      ? { name, source: 'queryParameter', type, fixed, value: parseValue(type, value).value }
      : { name, source: 'queryParameter', type, fixed, fromColumns: columnList(columns) },
  );

/**
 * The preset the form saves: unset values are left out, From row inputs keep no value, and query
 * parameters are inputs in place of the `parameters` param.
 */
export function formFields(
  action: CatalogueAction,
  params: Record<string, unknown>,
  form: PresetForm,
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
    menuPath: form.folder
      .split('/')
      .map((s) => s.trim())
      .filter((s) => s !== ''),
    visibility: form.visibility,
    action: action.key,
    params: kept,
    inputs,
  };
}

/** The types whose Kusto literals wrap the value in the type's name. */
const WRAPPED = new Set<QueryParameterType>(['datetime', 'timespan', 'dynamic']);

/**
 * A fixed query parameter as the connection receives it, or its type when it has no value yet:
 * a Kusto literal, or for a bound value its text, JSON for `dynamic`.
 */
function literalText({ type, value }: QueryParameterForm, bound: boolean): string {
  const parsed = parseValue(type, value).value;
  if (parsed === undefined) return `<${type}>`;
  const text = valueText(type, parsed);
  return !bound && WRAPPED.has(type) ? `${type}(${text})` : text;
}

/** What a From row input reads: the columns of the clicked row, or none to ask when opened. */
const fromRowText = (columns: readonly string[]): string =>
  columns.length > 0 ? `<${columns.join(' or ')} of the clicked row>` : 'asked for when opened';

/**
 * One line per param of the action: its value, the columns of the clicked row it reads, or when
 * it is unset the placeholder for its type. Query parameters have a line each in place of the
 * `parameters` param's: declared before KQL, or for SQL with the position each is bound to.
 */
export function previewLines(
  action: CatalogueAction,
  params: Record<string, unknown>,
  form: PresetForm,
): string[] {
  const declared = form.queryParameters;
  const bound = bindsByPosition(action.params);
  return action.params.flatMap((p) => {
    const mode = form.modes[p.name];
    if (isParametersParam(p)) {
      return declared.map(
        (qp, i) =>
          `${bound ? `${positionLabel(i, true)} ` : ''}${qp.name} = ${
            qp.fixed ? literalText(qp, bound) : fromRowText(columnList(qp.columns))
          }`,
      );
    }
    const line = `${p.title} = ${mode && !mode.fixed ? fromRowText(mode.columns) : valueOrType(p, params[p.name])}`;
    return p.kind === 'kql' && declared.length > 0 ? [declareStatement(declared), line] : [line];
  });
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
}: Preset): PresetFields => ({
  name,
  menuPath,
  visibility,
  action,
  params,
  inputs,
});
