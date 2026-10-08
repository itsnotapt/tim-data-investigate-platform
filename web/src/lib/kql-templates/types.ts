import type { components } from '../api/schema';

type Schemas = components['schemas'];

export type QueryParam = Schemas['QueryParam'];
export type QueryField = Schemas['QueryField'];

/** The parts of a stored template the engine needs; every API `QueryTemplate` satisfies it. */
export interface QueryTemplate {
  cluster: string;
  query: string;
  summary: string;
  params?: Record<string, QueryParam> | null;
  fields?: Record<string, QueryField> | null;
}

/** Values fed to Handlebars. */
export type TemplateParams = Record<string, unknown>;

/** A grid row (raw Kusto column name to value). */
export type Row = Record<string, unknown>;
