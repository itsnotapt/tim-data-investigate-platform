import { dump, load } from 'js-yaml';
import {
  isApiError,
  type QueryTemplate,
  type QueryTemplateCreate,
  type QueryTemplateReplace,
} from '../../lib/api';
import { generateUuid } from '../../lib/uuid';

type QueryType = QueryTemplate['queryType'];

export interface TemplateFormState {
  uuid: string;
  name: string;
  queryType: QueryType;
  menu: string;
  summary: string;
  path: string[];
  cluster: string;
  database: string;
  columnId: string;
  params: string;
  fields: string;
  columns: string;
  query: string;
  isManaged: boolean;
}

type YamlField = 'params' | 'fields' | 'columns';
export type FormErrors = Partial<
  Record<
    | 'name'
    | 'menu'
    | 'summary'
    | 'cluster'
    | 'database'
    | 'query'
    | 'params'
    | 'fields'
    | 'columns',
    string
  >
>;

/** YAML text for an optional mapping (`null`/`undefined` is an empty editor). */
function dumpYaml(value: unknown): string {
  return value === null || value === undefined ? '' : dump(value);
}

export function emptyForm(): TemplateFormState {
  return {
    uuid: generateUuid(),
    name: '',
    queryType: 'view',
    menu: '',
    summary: '',
    path: [],
    cluster: '',
    database: '',
    columnId: '',
    params: '',
    fields: '',
    columns: '',
    query: '',
    isManaged: false,
  };
}

export function formFromTemplate(t: QueryTemplate): TemplateFormState {
  return {
    uuid: t.uuid,
    name: t.name,
    queryType: t.queryType,
    menu: t.menu,
    summary: t.summary,
    path: t.path ?? [],
    cluster: t.cluster,
    database: t.database,
    columnId: t.columnId ?? '',
    params: dumpYaml(t.params),
    fields: dumpYaml(t.fields),
    columns: dumpYaml(t.columns),
    query: t.query,
    isManaged: t.isManaged === true,
  };
}

type ParsedYaml =
  { ok: true; value: Record<string, unknown> | undefined } | { ok: false; error: string };

/** Parses an editor's text: empty (or a null document) means "not set". Must be a mapping. */
function parseYamlMapping(text: string): ParsedYaml {
  // js-yaml 5 rejects an empty document; an empty editor just means "not set".
  if (text.trim() === '') return { ok: true, value: undefined };
  let value: unknown;
  try {
    value = load(text);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (value === undefined || value === null) return { ok: true, value: undefined };
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'Must be a YAML mapping (name: definition).' };
  }
  return { ok: true, value: value as Record<string, unknown> };
}

export type BuildResult =
  | { ok: true; body: QueryTemplateCreate & QueryTemplateReplace }
  | { ok: false; errors: FormErrors };

const REQUIRED: [keyof FormErrors & keyof TemplateFormState, string][] = [
  ['name', 'Name is required'],
  ['menu', 'Menu text is required'],
  ['summary', 'Summary text is required'],
  ['cluster', 'Cluster is required'],
  ['database', 'Database is required'],
  ['query', 'Query is required'],
];

/**
 * Validates the form and builds the request body. Never includes `createdBy`/`updatedBy`/
 * `updated`. `fields` is sent for `view` templates only if it parses.
 */
export function buildBody(form: TemplateFormState): BuildResult {
  const errors: FormErrors = {};
  for (const [key, message] of REQUIRED) {
    if (form[key].trim() === '') errors[key] = message;
  }
  const parsed = {} as Record<YamlField, Record<string, unknown> | undefined>;
  for (const key of ['params', 'fields', 'columns'] as const) {
    const r = parseYamlMapping(form[key]);
    if (r.ok) parsed[key] = r.value;
    else if (key !== 'fields' || form.queryType === 'query') errors[key] = r.error;
  }
  if (form.queryType === 'query' && !errors.fields && !parsed.fields) {
    errors.fields = 'Fields are required for a query-type template.';
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const columnId = form.columnId.trim();
  const body = {
    uuid: form.uuid,
    name: form.name,
    isManaged: form.isManaged,
    isDeleted: false,
    queryType: form.queryType,
    menu: form.menu,
    summary: form.summary,
    path: form.path,
    cluster: form.cluster,
    database: form.database,
    columnId: columnId === '' ? null : columnId,
    params: parsed.params ?? null,
    fields: parsed.fields ?? null,
    columns: parsed.columns ?? null,
    query: form.query,
  } as QueryTemplateCreate & QueryTemplateReplace;
  return { ok: true, body };
}

/** Message for any save failure: ApiError detail plus per-field errors; never throws. */
export function describeSaveError(e: unknown): string {
  if (isApiError(e)) {
    const fieldErrors = e.errors
      ? Object.entries(e.errors).map(([k, v]) => `${k}: ${v.join(' ')}`)
      : [];
    const detail = e.detail || e.title;
    return [detail, ...fieldErrors.filter((l) => !detail.includes(l))].join('\n');
  }
  return e instanceof Error && e.message ? e.message : 'Saving the query failed.';
}
