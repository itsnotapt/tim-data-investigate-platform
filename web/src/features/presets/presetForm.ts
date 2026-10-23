import type {
  CatalogueAction,
  CatalogueParam,
  Preset,
  PresetFields,
  PresetInput,
} from '../../lib/api';
import { isUnset, paramText } from '../action-tab/paramValues';

/** How one param that rows can fill is saved: its value fixed, or read from the clicked row. */
export interface InputMode {
  fixed: boolean;
  /** From row only: the columns to read, in order; none asks for the value when opened. */
  columns: string[];
}

/** What the Save… dialog edits. */
export interface PresetForm {
  name: string;
  /** Folders, separated by `/`. */
  folder: string;
  visibility: Preset['visibility'];
  /** By param name, for each param of the action with `fromColumns`. */
  modes: Record<string, InputMode>;
}

/** The params of `action` that rows can fill: those with `fromColumns`. */
export const rowParams = (action: CatalogueAction): CatalogueParam[] =>
  action.params.filter((p) => (p.fromColumns ?? []).length > 0);

/**
 * The form for saving `params` of `action`. From an existing preset, its name, folder and inputs;
 * otherwise each set value is fixed and each unset one is read from all its columns. A copy of
 * someone else's preset starts private.
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
  };
}

/** The preset the form saves: unset values are left out, and From row inputs keep no value. */
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
    if (mode && !mode.fixed) {
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

/**
 * One line per param of the action: its value, the columns of the clicked row it reads, or when
 * it is unset the placeholder for its type.
 */
export function previewLines(
  action: CatalogueAction,
  params: Record<string, unknown>,
  form: PresetForm,
): string[] {
  return action.params.flatMap((p) => {
    const mode = form.modes[p.name];
    if (mode && !mode.fixed) {
      const read =
        mode.columns.length > 0
          ? `<${mode.columns.join(' or ')} of the clicked row>`
          : 'asked for when opened';
      return [`${p.title} = ${read}`];
    }
    return [`${p.title} = ${valueOrType(p, params[p.name])}`];
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
