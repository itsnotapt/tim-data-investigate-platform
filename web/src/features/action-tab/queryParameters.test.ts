import { describe, expect, it } from 'vitest';
import type { CatalogueParam } from '../../lib/api';
import { pills } from './queryParameters';

const param = (name: string, kind: CatalogueParam['kind']): CatalogueParam => ({
  name,
  title: name,
  kind,
  required: true,
  many: false,
});
const snowflake: CatalogueParam = {
  ...param('connection', 'connection'),
  connectionType: 'snowflake',
};
const parameters = param('parameters', 'json');
const values = {
  parameters: [
    { name: 'upn', type: 'string', value: 'alice@example.com' },
    { name: 'since', type: 'datetime', value: null },
  ],
};

describe('pills', () => {
  it("says the position each of SQL's query parameters is bound to", () => {
    const { params } = pills([snowflake, parameters], values);
    expect(params.slice(1).map((p) => p.help)).toEqual([
      'Query parameter :1, string',
      'Query parameter :2, datetime',
    ]);
  });

  it("gives KQL's query parameters no position, as Kusto takes them by name", () => {
    const { params } = pills([param('kql', 'kql'), parameters], values);
    expect(params.slice(1).map((p) => p.help)).toEqual([
      'Query parameter, string',
      'Query parameter, datetime',
    ]);
  });
});
