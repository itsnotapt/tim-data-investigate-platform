import type { QueryField, QueryParam, TemplateParams } from '../../lib/kql-templates';

export const REQUIRED_MESSAGE = 'Required.';

/** A param or field as the form sees it (legacy merges `params` and `fields`, fields win). */
export type FormField = QueryParam | QueryField;

export interface FormFieldEntry {
  name: string;
  field: FormField;
}

/** `{...params, ...fields}` in declaration order (legacy TemplateQueryResult.vue v-for). */
export function getFormFields(template: {
  params?: Record<string, QueryParam> | null;
  fields?: Record<string, QueryField> | null;
}): FormFieldEntry[] {
  const merged: Record<string, FormField> = { ...template.params, ...template.fields };
  return Object.entries(merged).map(([name, field]) => ({ name, field }));
}

/** `optional !== true` means required (legacy). `QueryField` has no `optional`, so required. */
export const isRequired = (field: FormField): boolean => (field as QueryParam).optional !== true;

/** Blank for the required rule: missing, empty/whitespace string or empty list. */
export function isBlankValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * Validation errors by field name. Booleans are never required (a switch is always valid).
 * Legacy `!!value` accepted `[]` and rejected `0`; here an empty list is blank (it could never
 * produce a runnable query, `isDataComplete`) and numbers are fine.
 */
export function validateParams(
  fields: FormFieldEntry[],
  params: TemplateParams,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const { name, field } of fields) {
    if (field.type === 'boolean' || !isRequired(field)) continue;
    if (isBlankValue(params[name])) errors[name] = REQUIRED_MESSAGE;
  }
  return errors;
}
