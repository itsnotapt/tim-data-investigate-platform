import type * as Monaco from 'monaco-editor';

/** A Snowflake connection's editor schema (kind `sql`): its databases down to their columns. */
export interface SqlSchema {
  databases: {
    name: string;
    schemas: {
      name: string;
      tables: { name: string; columns: { name: string; type: string }[] }[];
    }[];
  }[];
}

export interface SqlSuggestion {
  label: string;
  kind: 'database' | 'schema' | 'table' | 'column';
  detail?: string;
  /** The name as SQL: quoted unless it's what an unquoted name resolves to. */
  insertText: string;
}

type SqlTable = SqlSchema['databases'][number]['schemas'][number]['tables'][number];

const IDENTIFIER = String.raw`(?:"(?:[^"]|"")*"|[A-Za-z_][\w$]*)`;
// The dotted names before the cursor, then the name being typed (perhaps an open quote).
const PATH = new RegExp(String.raw`((?:${IDENTIFIER}\.)*)("(?:[^"]|"")*|[\w$]*)$`);
const NAME = new RegExp(IDENTIFIER, 'g');
// Words that can follow a table in FROM or JOIN, so aren't its alias.
const CLAUSES = `
  WHERE GROUP ORDER HAVING QUALIFY LIMIT OFFSET FETCH UNION EXCEPT MINUS INTERSECT JOIN INNER
  LEFT RIGHT FULL CROSS NATURAL ASOF LATERAL ON USING SAMPLE TABLESAMPLE PIVOT UNPIVOT
  MATCH_RECOGNIZE CHANGES AT BEFORE WINDOW
`
  .trim()
  .split(/\s+/)
  .join('|');
// A table the query reads, `FROM db.schema.table [AS] alias`, its path perhaps shortened.
const REFERENCE = new RegExp(
  String.raw`\b(?:FROM|JOIN)\s+(${IDENTIFIER}(?:\.${IDENTIFIER}){0,2})(?:\s+(?:AS\s+)?(?!(?:${CLAUSES})\b)(${IDENTIFIER}))?`,
  'gi',
);
const PLAIN = /^[A-Z_][A-Z0-9_$]*$/;

const quoted = (name: string) => (PLAIN.test(name) ? name : `"${name.replaceAll('"', '""')}"`);

const unquoted = (typed: string) => typed.slice(1, -1).replaceAll('""', '"');

/** Whether a name typed in SQL names `name`: quoted exactly, unquoted in any case. */
function matchesName(typed: string, name: string): boolean {
  return typed.startsWith('"')
    ? unquoted(typed) === name
    : typed.toUpperCase() === name.toUpperCase();
}

/** A name typed in SQL as Snowflake resolves it: quoted exactly, unquoted in upper case. */
const resolved = (typed: string) => (typed.startsWith('"') ? unquoted(typed) : typed.toUpperCase());

/** The tables the query's FROM and JOIN clauses read, each with the name that refers to it. */
function queryTables(schema: SqlSchema, query: string): { ref: string; table: SqlTable }[] {
  const found = [];
  for (const [, path, alias] of query.matchAll(REFERENCE)) {
    const typed = path!.match(NAME)!;
    for (const database of schema.databases) {
      for (const sqlSchema of database.schemas) {
        for (const table of sqlSchema.tables) {
          const names = [database.name, sqlSchema.name, table.name].slice(3 - typed.length);
          if (typed.every((t, i) => matchesName(t, names[i]!))) {
            found.push({ ref: alias ?? typed.at(-1)!, table });
          }
        }
      }
    }
  }
  return found;
}

/**
 * What to complete after `before`, the line up to the cursor, in `query`: the databases and the
 * query's columns, then after `DB.` its schemas (or after a table's alias or name, its columns),
 * then its tables, then their columns. `start` is where the name being typed begins.
 */
export function sqlSuggestions(
  schema: SqlSchema,
  before: string,
  query: string = before,
): { start: number; suggestions: SqlSuggestion[] } {
  const match = PATH.exec(before)!;
  const start = match.index + match[1]!.length;
  const path = match[1]!.match(NAME) ?? [];
  const [databaseName, schemaName, tableName, ...rest] = path;
  const find = <T extends { name: string }>(items: T[] | undefined, typed: string) =>
    items?.find((item) => matchesName(typed, item.name));
  const suggest = (kind: SqlSuggestion['kind'], items: { name: string; type?: string }[] = []) =>
    items.map(({ name, type }) => ({
      label: name,
      kind,
      ...(type === undefined ? {} : { detail: type }),
      insertText: quoted(name),
    }));
  const columnsOf = (tables: { table: SqlTable }[]) =>
    suggest(
      'column',
      [...new Set(tables.map((t) => t.table))].flatMap((t) => t.columns),
    );

  if (databaseName === undefined) {
    const columns = columnsOf(queryTables(schema, query));
    return { start, suggestions: [...columns, ...suggest('database', schema.databases)] };
  }
  const database = find(schema.databases, databaseName);
  if (schemaName === undefined) {
    const named = queryTables(schema, query).filter(
      (t) => resolved(t.ref) === resolved(databaseName),
    );
    return { start, suggestions: [...columnsOf(named), ...suggest('schema', database?.schemas)] };
  }
  const sqlSchema = find(database?.schemas, schemaName);
  if (tableName === undefined) return { start, suggestions: suggest('table', sqlSchema?.tables) };
  if (rest.length > 0) return { start, suggestions: [] };
  return { start, suggestions: suggest('column', find(sqlSchema?.tables, tableName)?.columns) };
}

const schemas = new WeakMap<Monaco.editor.ITextModel, SqlSchema>();
let registered: Promise<void> | null = null;

/** Completion for language `sql`, from each model's schema; registered once for all editors. */
function registerSqlCompletion(): Promise<void> {
  registered ??= import('monaco-editor/esm/vs/editor/editor.api').then((monaco) => {
    const { CompletionItemKind } = monaco.languages;
    const kinds = {
      database: CompletionItemKind.Module,
      schema: CompletionItemKind.Folder,
      table: CompletionItemKind.Class,
      column: CompletionItemKind.Field,
    };
    monaco.languages.registerCompletionItemProvider('sql', {
      triggerCharacters: ['.'],
      provideCompletionItems: (model, position) => {
        const schema = schemas.get(model);
        if (!schema) return { suggestions: [] };
        const { lineNumber, column } = position;
        const before = model.getLineContent(lineNumber).slice(0, column - 1);
        const { start, suggestions } = sqlSuggestions(schema, before, model.getValue());
        const range = {
          startLineNumber: lineNumber,
          startColumn: start + 1,
          endLineNumber: lineNumber,
          endColumn: column,
        };
        return {
          suggestions: suggestions.map((s) => ({
            label: s.label,
            kind: kinds[s.kind],
            detail: s.detail,
            insertText: s.insertText,
            filterText: s.insertText,
            range,
          })),
        };
      },
    });
  });
  return registered;
}

/** Gives `editor` completion from `schema`, unless `signal` has aborted. */
export async function setSqlSchema(
  editor: Monaco.editor.IStandaloneCodeEditor,
  schema: SqlSchema,
  signal: AbortSignal,
): Promise<void> {
  const model = editor.getModel();
  if (!model || signal.aborted) return;
  schemas.set(model, schema);
  await registerSqlCompletion();
}
