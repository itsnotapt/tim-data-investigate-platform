import { describe, expect, it, vi } from 'vitest';
import type { CodeEditorInstance } from '../../components/CodeEditor';
import { applyEditorSchema } from './editorSchemaAdapters';
import { sqlSuggestions, type SqlSchema } from './sqlSchema';

type CompletionProvider = {
  triggerCharacters: string[];
  provideCompletionItems: (
    model: unknown,
    position: { lineNumber: number; column: number },
  ) => { suggestions: Record<string, unknown>[] };
};
const h = vi.hoisted(() => ({ providers: [] as { language: string; provider: unknown }[] }));
vi.mock('monaco-editor/esm/vs/editor/editor.api', () => ({
  languages: {
    CompletionItemKind: { Module: 8, Folder: 23, Class: 5, Field: 3 },
    registerCompletionItemProvider: (language: string, provider: unknown) => {
      h.providers.push({ language, provider });
      return { dispose: () => {} };
    },
  },
}));

const schema: SqlSchema = {
  databases: [
    {
      name: 'SALES',
      schemas: [
        {
          name: 'PUBLIC',
          tables: [
            {
              name: 'ORDERS',
              columns: [
                { name: 'ID', type: 'NUMBER' },
                { name: 'placed at', type: 'TIMESTAMP_NTZ' },
              ],
            },
          ],
        },
        { name: 'Raw', tables: [] },
      ],
    },
    { name: 'HR', schemas: [] },
  ],
};

const labels = (before: string) => sqlSuggestions(schema, before).suggestions.map((s) => s.label);

describe('sqlSuggestions', () => {
  it('offers the databases, then a database’s schemas, its tables and their columns', () => {
    expect(labels('SELECT * FROM ')).toEqual(['SALES', 'HR']);
    expect(labels('SELECT * FROM SALES.')).toEqual(['PUBLIC', 'Raw']);
    expect(labels('SELECT * FROM SALES.PUBLIC.')).toEqual(['ORDERS']);
    expect(sqlSuggestions(schema, 'SELECT SALES.PUBLIC.ORDERS.').suggestions).toEqual([
      { label: 'ID', kind: 'column', detail: 'NUMBER', insertText: 'ID' },
      { label: 'placed at', kind: 'column', detail: 'TIMESTAMP_NTZ', insertText: '"placed at"' },
    ]);
  });

  it('matches unquoted names in any case, quoted ones exactly, and quotes names that need it', () => {
    expect(labels('FROM sales.public.')).toEqual(['ORDERS']);
    expect(labels('FROM "SALES"."PUBLIC".')).toEqual(['ORDERS']);
    expect(labels('FROM "sales".')).toEqual([]);
    expect(sqlSuggestions(schema, 'FROM SALES.').suggestions[1]).toMatchObject({
      label: 'Raw',
      kind: 'schema',
      insertText: '"Raw"',
    });
    expect(labels('FROM NOPE.')).toEqual([]);
  });

  it('offers the columns of the query’s tables, alone after their alias or name', () => {
    const query = 'SELECT  FROM SALES.PUBLIC.ORDERS o WHERE ';
    const columns = ['ID', 'placed at'];
    expect(sqlSuggestions(schema, 'SELECT ', query).suggestions.map((s) => s.label)).toEqual([
      ...columns,
      'SALES',
      'HR',
    ]);
    expect(labels(query)).toEqual([...columns, 'SALES', 'HR']);
    const columnsAfter = (before: string, q: string) =>
      sqlSuggestions(schema, before, q).suggestions.map((s) => s.label);
    expect(columnsAfter('SELECT o.', 'SELECT o. FROM SALES.PUBLIC.ORDERS o')).toEqual(columns);
    expect(columnsAfter('SELECT x.', 'SELECT x. FROM sales.public.orders AS x')).toEqual(columns);
    expect(columnsAfter('SELECT orders.', 'SELECT orders. FROM PUBLIC.ORDERS')).toEqual(columns);
    expect(columnsAfter('SELECT o.', 'SELECT o. FROM SALES.PUBLIC.NOPE o')).toEqual([]);
    expect(columnsAfter('SELECT o.', 'SELECT o. FROM ORDERS JOIN HR.PUBLIC.ORDERS o')).toEqual([]);
  });

  it('replaces from the start of the name being typed, quote included', () => {
    expect(sqlSuggestions(schema, 'FROM SALES.PU').start).toBe('FROM SALES.'.length);
    expect(sqlSuggestions(schema, 'FROM SALES."Ra').start).toBe('FROM SALES.'.length);
    expect(sqlSuggestions(schema, 'FROM ').start).toBe('FROM '.length);
  });
});

describe('the sql adapter', () => {
  const editorOf = (model: object) => ({ getModel: () => model }) as unknown as CodeEditorInstance;
  const modelWith = (...lines: string[]) => ({
    getLineContent: (lineNumber: number) => lines[lineNumber - 1],
    getValue: () => lines.join('\n'),
  });
  const loaded = (s: SqlSchema) => ({ kind: 'sql', schema: s, connection: 'wh', scope: {} });

  it('completes from the schema of the editor’s model, with one provider for all editors', async () => {
    const model = modelWith('-- Orders', '', 'SELECT * FROM SALES.PUBLIC.OR');
    const other = modelWith('SELECT * FROM SALES.');
    await applyEditorSchema(editorOf(model), loaded(schema), new AbortController().signal);
    await applyEditorSchema(editorOf(other), loaded(schema), new AbortController().signal);

    const [registered, ...more] = h.providers;
    expect(more).toEqual([]);
    expect(registered!.language).toBe('sql');
    const provider = registered!.provider as CompletionProvider;
    expect(provider.triggerCharacters).toEqual(['.']);
    const position = { lineNumber: 3, column: 'SELECT * FROM SALES.PUBLIC.OR'.length + 1 };
    expect(provider.provideCompletionItems(model, position).suggestions).toEqual([
      {
        label: 'ORDERS',
        kind: 5,
        detail: undefined,
        insertText: 'ORDERS',
        filterText: 'ORDERS',
        range: { startLineNumber: 3, startColumn: 28, endLineNumber: 3, endColumn: 30 },
      },
    ]);
    expect(provider.provideCompletionItems(modelWith('SALES.'), position).suggestions).toEqual([]);
  });

  it('completes the columns of tables named anywhere in the query', async () => {
    const model = modelWith('SELECT o.', 'FROM SALES.PUBLIC.ORDERS o');
    await applyEditorSchema(editorOf(model), loaded(schema), new AbortController().signal);
    const provider = h.providers[0]!.provider as CompletionProvider;
    const suggestions = provider.provideCompletionItems(model, { lineNumber: 1, column: 10 });
    expect(suggestions.suggestions.map((s) => [s.label, s.kind])).toEqual([
      ['ID', 3],
      ['placed at', 3],
    ]);
  });

  it('leaves the editor alone once the schema is stale', async () => {
    const model = modelWith('SALES.');
    const stale = new AbortController();
    stale.abort();
    await applyEditorSchema(editorOf(model), loaded(schema), stale.signal);
    const provider = h.providers[0]!.provider as CompletionProvider;
    expect(
      provider.provideCompletionItems(model, { lineNumber: 1, column: 7 }).suggestions,
    ).toEqual([]);
  });
});
