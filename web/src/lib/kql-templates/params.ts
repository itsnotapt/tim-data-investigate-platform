import type { QueryTemplate, Row, TemplateParams } from './types';

/**
 * Defaults for every declared param. Falsy defaults (`false`, `0`) are kept; only a missing
 * (undefined/null) default becomes ''.
 */
export function getDefaultParams(template: QueryTemplate): TemplateParams {
  const out: TemplateParams = {};
  for (const [name, param] of Object.entries(template.params ?? {})) {
    out[name] = param.default ?? '';
  }
  return out;
}

function matchingColumns(regex: string | null | undefined, data: Row): string[] {
  let re: RegExp;
  try {
    re = new RegExp(regex ?? '');
  } catch {
    return []; // an invalid stored regex matches nothing rather than crashing the menu
  }
  return Object.keys(data).filter((col) => re.test(col) && !isBlank(data[col]));
}

const isBlank = (v: unknown): boolean => v === null || v === undefined || v === '';

/**
 * Params for a new template query from a clicked row (`data`) and the selected rows
 * (`multipleData`; callers pass the clicked row when nothing is selected).
 * Starts from the defaults, then per field:
 * - `multiple`: `from` column of every selected row, blanks dropped;
 * - `match`: `[{column, value}]` for each non-blank column whose name matches `regex`;
 * - otherwise: `data[fieldName] ?? ''`.
 */
export function buildParams(
  template: QueryTemplate,
  data: Row,
  multipleData: Row[] = [],
): TemplateParams {
  const params = getDefaultParams(template);
  for (const [name, field] of Object.entries(template.fields ?? {})) {
    if (field.type === 'multiple') {
      const from = field.from;
      params[name] = multipleData
        .map((row) => (from === undefined || from === null ? '' : (row[from] ?? '')))
        .filter((v) => !isBlank(v));
    } else if (field.type === 'match') {
      params[name] = matchingColumns(field.regex, data).map((column) => ({
        column,
        value: data[column],
      }));
    } else {
      params[name] = data[name] ?? '';
    }
  }
  return params;
}

/**
 * True when every declared field has a usable value: `multiple` needs at least one entry,
 * `match` exactly one matching column, others a non-blank value.
 */
export function isDataComplete(template: QueryTemplate, data: TemplateParams): boolean {
  return Object.entries(template.fields ?? {}).every(([name, field]) => {
    const value = data[name];
    if (field.type === 'multiple') return Array.isArray(value) && value.length > 0;
    if (field.type === 'match') return Array.isArray(value) && value.length === 1;
    return name in data && !isBlank(value);
  });
}
