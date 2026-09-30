import { describe, expect, it } from 'vitest';
import {
  buildParams,
  createTemplateEngine,
  getDefaultParams,
  isDataComplete,
  type QueryTemplate,
} from './index';
import legacy from './__fixtures__/getTagEvents.legacy.kql?raw';
import { escapeKqlString, escapeKqlVerbatim, kqlVerbatimList } from './escape';

const engine = createTemplateEngine({
  tagCluster: 'https://tags.kusto.windows.net',
  tagDatabase: 'Research',
});

function tpl(p: Partial<QueryTemplate> = {}): QueryTemplate {
  return { cluster: 'https://c', query: '', summary: '', ...p };
}

describe('getDefaultParams', () => {
  it('returns defaults and empty string for missing defaults', () => {
    const t = tpl({
      params: { a: { type: 'string', default: 'x' }, b: { type: 'string' } },
    });
    expect(getDefaultParams(t)).toEqual({ a: 'x', b: '' });
  });

  it('keeps falsy defaults (BUG-34)', () => {
    const t = tpl({
      params: {
        f: { type: 'boolean', default: false },
        z: { type: 'number', default: 0 },
        e: { type: 'string', default: '' },
        n: { type: 'string', default: null },
      },
    });
    expect(getDefaultParams(t)).toEqual({ f: false, z: 0, e: '', n: '' });
  });

  it('handles absent or null params', () => {
    expect(getDefaultParams(tpl())).toEqual({});
    expect(getDefaultParams(tpl({ params: null }))).toEqual({});
  });
});

describe('buildParams', () => {
  it('starts from defaults (same falsy handling as getDefaultParams)', () => {
    const t = tpl({ params: { f: { type: 'boolean', default: false } } });
    expect(buildParams(t, {}, [])).toEqual(getDefaultParams(t));
    expect(buildParams(t, {}, []).f).toBe(false);
  });

  it('plain field reads the row, missing becomes empty string', () => {
    const t = tpl({ fields: { Host: { type: 'string' }, Gone: { type: 'string' } } });
    expect(buildParams(t, { Host: 'h1' }, [])).toEqual({ Host: 'h1', Gone: '' });
  });

  it('plain field keeps 0 and false', () => {
    const t = tpl({ fields: { N: { type: 'string' }, B: { type: 'string' } } });
    expect(buildParams(t, { N: 0, B: false }, [])).toEqual({ N: 0, B: false });
  });

  it('plain field overrides a param default', () => {
    const t = tpl({
      params: { Host: { type: 'string', default: 'd' } },
      fields: { Host: { type: 'string' } },
    });
    expect(buildParams(t, { Host: 'row' }, []).Host).toBe('row');
  });

  it('multiple field collects from selected rows and drops blanks', () => {
    const t = tpl({ fields: { Users: { type: 'multiple', from: 'User' } } });
    const rows = [{ User: 'a' }, { User: '' }, { User: null }, {}, { User: 'b' }];
    expect(buildParams(t, rows[0] ?? {}, rows).Users).toEqual(['a', 'b']);
  });

  it('multiple field with no rows is an empty array', () => {
    const t = tpl({ fields: { Users: { type: 'multiple', from: 'User' } } });
    expect(buildParams(t, {}, []).Users).toEqual([]);
  });

  it('multiple field without `from` yields nothing', () => {
    const t = tpl({ fields: { Users: { type: 'multiple' } } });
    expect(buildParams(t, {}, [{ User: 'a' }]).Users).toEqual([]);
  });

  it('match field returns matching non-blank columns', () => {
    const t = tpl({ fields: { Ip: { type: 'match', regex: '^Ip' } } });
    const row = { IpA: '1.1.1.1', IpB: '', IpC: null, Other: 'x', IpD: 0 };
    expect(buildParams(t, row, []).Ip).toEqual([
      { column: 'IpA', value: '1.1.1.1' },
      { column: 'IpD', value: 0 },
    ]);
  });

  it('match field with an invalid regex matches nothing', () => {
    const t = tpl({ fields: { Ip: { type: 'match', regex: '(' } } });
    expect(buildParams(t, { a: 1 }, []).Ip).toEqual([]);
  });

  it('does not mutate inputs', () => {
    const t = tpl({ params: { p: { type: 'string', default: 'x' } } });
    const row = { a: 1 };
    buildParams(t, row, [row]);
    expect(row).toEqual({ a: 1 });
    expect(t.params?.p?.default).toBe('x');
  });
});

describe('isDataComplete', () => {
  const t = tpl({
    fields: {
      Host: { type: 'string' },
      Users: { type: 'multiple', from: 'User' },
      Ip: { type: 'match', regex: '^Ip' },
    },
  });
  const full = { Host: 'h', Users: ['a'], Ip: [{ column: 'IpA', value: '1' }] };

  it('is true when all fields are usable', () => {
    expect(isDataComplete(t, full)).toBe(true);
  });
  it('is true with no fields', () => {
    expect(isDataComplete(tpl(), {})).toBe(true);
    expect(isDataComplete(tpl({ fields: null }), {})).toBe(true);
  });
  it.each(['', null, undefined])('plain field %j is incomplete', (v) => {
    expect(isDataComplete(t, { ...full, Host: v })).toBe(false);
  });
  it('plain field 0 and false count as present', () => {
    const p = tpl({ fields: { N: { type: 'string' } } });
    expect(isDataComplete(p, { N: 0 })).toBe(true);
    expect(isDataComplete(p, { N: false })).toBe(true);
  });
  it('missing plain field key is incomplete', () => {
    expect(isDataComplete(t, { Users: ['a'], Ip: full.Ip })).toBe(false);
  });
  it('multiple needs at least one value', () => {
    expect(isDataComplete(t, { ...full, Users: [] })).toBe(false);
    expect(isDataComplete(t, { ...full, Users: undefined })).toBe(false);
  });
  it('match needs exactly one column (legacy)', () => {
    expect(isDataComplete(t, { ...full, Ip: [] })).toBe(false);
    expect(
      isDataComplete(t, {
        ...full,
        Ip: [
          { column: 'a', value: 1 },
          { column: 'b', value: 2 },
        ],
      }),
    ).toBe(false);
  });
});

describe('escaping helpers', () => {
  it('escapeKqlVerbatim doubles quotes only', () => {
    expect(escapeKqlVerbatim(`a'b"c\\d`)).toBe(`a''b"c\\d`);
  });
  it('escapeKqlString escapes backslash, quotes, control chars', () => {
    expect(escapeKqlString(`a\\b'c"d\ne\r\tf`)).toBe(`a\\\\b\\'c\\"d\\ne\\r\\tf`);
  });
  it('kqlVerbatimList handles nullish, scalars and objects', () => {
    expect(kqlVerbatimList(undefined)).toBe('');
    expect(kqlVerbatimList(null)).toBe('');
    expect(kqlVerbatimList([])).toBe('');
    expect(kqlVerbatimList('x')).toBe("@'x'");
    expect(kqlVerbatimList([1, true, { column: 'c', value: 'v' }])).toBe("@'1',@'true',@'v'");
  });
});

describe('rendering', () => {
  it('array helper matches legacy output for ordinary values', () => {
    expect(engine.render('in ({{array Users}})', { Users: ['a', 'b'] })).toBe("in (@'a',@'b')");
  });

  it('array helper renders an empty list as nothing', () => {
    expect(engine.render('in ({{array Users}})', { Users: [] })).toBe('in ()');
    expect(engine.render('in ({{array Users}})', {})).toBe('in ()');
  });

  it('array helper escapes quotes (SEC-06)', () => {
    expect(engine.render('{{array xs}}', { xs: ["a'b"] })).toBe("@'a''b'");
  });

  it('array helper neutralises a classic injection', () => {
    const evil = "x') | union (cluster('evil').database('d').T) | where ('1'=='1";
    const out = engine.render('T | where U in ({{array xs}})', { xs: [evil] });
    expect(out).toBe(`T | where U in (@'${evil.replace(/'/g, "''")}')`);
    const literal = out.slice(out.indexOf("@'") + 2, out.lastIndexOf("'"));
    expect(literal.replace(/''/g, '')).not.toContain("'");
  });

  it('array helper does not escape backslashes (verbatim literal)', () => {
    expect(engine.render('{{array xs}}', { xs: ['C:\\Temp\\'] })).toBe("@'C:\\Temp\\'");
  });

  it('array helper: backslash-quote cannot break out', () => {
    expect(engine.render('{{array xs}}', { xs: ["\\'"] })).toBe("@'\\'''");
  });

  it('str helper emits one verbatim literal', () => {
    expect(engine.render('where A == {{str v}}', { v: "o'neil" })).toBe("where A == @'o''neil'");
  });

  it('kql helper emits a regular literal with escapes', () => {
    expect(engine.render('where A == {{kql v}}', { v: `a\\'"\n` })).toBe(
      `where A == 'a\\\\\\'\\"\\n'`,
    );
  });

  it('kql helper blocks breakout via backslash-quote', () => {
    expect(engine.render('{{kql v}}', { v: "\\' or 1==1 //" })).toBe("'\\\\\\' or 1==1 //'");
  });

  it('raw {{x}} is substituted unchanged, not HTML-escaped (Q-024)', () => {
    expect(engine.render('where A == "{{v}}" & <b>', { v: `<a> & 'q'` })).toBe(
      `where A == "<a> & 'q'" & <b>`,
    );
  });

  it('missing and nullish values render as empty', () => {
    expect(engine.render('[{{a}}][{{b}}]', { b: null })).toBe('[][]');
  });

  it('falsy values render as text', () => {
    expect(engine.render('{{a}}/{{b}}', { a: 0, b: false })).toBe('0/false');
  });

  it('does not expose prototype properties to templates', () => {
    expect(engine.render('[{{constructor}}][{{__proto__}}]', {})).toBe('[][]');
    expect(engine.render('{{#with a}}{{constructor.name}}{{/with}}', { a: {} })).toBe('');
  });

  it('template syntax inside param values is not evaluated', () => {
    expect(engine.render('{{v}}', { v: '{{array xs}}' })).toBe('{{array xs}}');
  });

  it('uses an isolated Handlebars environment', async () => {
    const { default: Handlebars } = await import('handlebars');
    Handlebars.registerHelper('array', () => 'GLOBAL');
    try {
      expect(engine.render('{{array xs}}', { xs: ['a'] })).toBe("@'a'");
      expect(() => Handlebars.compile('{{> getTagEvents}}')({})).toThrow(/partial/i);
    } finally {
      Handlebars.unregisterHelper('array');
    }
  });

  it('engines do not share state', () => {
    const other = createTemplateEngine({ tagCluster: 'https://other', tagDatabase: 'Db' });
    expect(other.render('{{> getTagEvents}}', {})).toContain("cluster('https://other')");
    expect(engine.render('{{> getTagEvents}}', {})).toContain("cluster('https://tags.kusto");
  });
});

describe('buildSummary / buildCluster / buildQuery', () => {
  const t = tpl({
    summary: 'Logons for {{User}}',
    cluster: 'https://{{Region}}.kusto.windows.net',
    query: 'Logons | where AccountName in ({{array Users}}) | where Host == {{str Host}}',
  });
  const params = { User: 'bob', Region: 'eu', Users: ['a', "b'c"], Host: 'h1' };

  it('buildSummary', () => {
    expect(engine.buildSummary(t, params)).toBe('Logons for bob');
  });
  it('buildCluster', () => {
    expect(engine.buildCluster(t, params)).toBe('https://eu.kusto.windows.net');
  });
  it('buildQuery', () => {
    expect(engine.buildQuery(t, params)).toBe(
      "Logons | where AccountName in (@'a',@'b''c') | where Host == @'h1'",
    );
  });
  it('end to end: clicked row to query', () => {
    const tt = tpl({
      fields: { Users: { type: 'multiple', from: 'User' } },
      query: 'T | where U in ({{array Users}})',
    });
    const rows = [{ User: 'a' }, { User: "b'" }];
    const p = buildParams(tt, rows[0] ?? {}, rows);
    expect(isDataComplete(tt, p)).toBe(true);
    expect(engine.buildQuery(tt, p)).toBe("T | where U in (@'a',@'b''')");
  });
});

describe('getTagEvents partial', () => {
  it('renders exactly the legacy KQL text', () => {
    expect(engine.render('{{> getTagEvents}}', {})).toBe(legacy);
  });

  it('is unchanged inside a query (standalone partial swallows its own newline, as legacy)', () => {
    const q = engine.render('let T = X;\n{{> getTagEvents}}\ngetTagEvents(T)', {});
    expect(q).toBe(`let T = X;\n${legacy}getTagEvents(T)`);
  });

  it('escapes quotes in configured cluster and database', () => {
    const e = createTemplateEngine({ tagCluster: "https://a'b", tagDatabase: "d'b" });
    const out = e.render('{{> getTagEvents}}', {});
    expect(out).toContain("cluster('https://a''b').database('d''b').SavedEvent");
  });
});
