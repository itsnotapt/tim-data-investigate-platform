import { describe, expect, it } from 'vitest';
import { normalizeSchema } from './kustoSchema';

const doc = (name: string) => ({
  Databases: { [name]: { Tables: {}, Functions: {}, EntityGroups: {}, Graphs: {} } },
});

describe('normalizeSchema', () => {
  it('accepts the schema variants', () => {
    const d = doc('x');
    expect(normalizeSchema(d)).toEqual(d);
    expect(normalizeSchema({ ClusterSchema: JSON.stringify(d) })).toEqual(d);
    expect(normalizeSchema({ DatabaseSchema: d })).toEqual(d);
    expect(normalizeSchema(JSON.stringify(d))).toEqual(d);
    expect(normalizeSchema({ data: [{ ClusterSchema: JSON.stringify(d) }] })).toEqual(d);
    expect(() => normalizeSchema({})).toThrow();
    expect(() => normalizeSchema(undefined)).toThrow();
  });

  it('fills the database members monaco-kusto reads unconditionally (Graphs)', () => {
    const out = normalizeSchema({ Databases: { D: { Name: 'D', Tables: {} } } }) as {
      Databases: Record<string, Record<string, unknown>>;
    };
    expect(out.Databases['D']).toMatchObject({
      Name: 'D',
      Functions: {},
      Graphs: {},
      EntityGroups: {},
    });
  });
});
