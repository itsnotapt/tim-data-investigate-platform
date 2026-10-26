import { afterEach, vi } from 'vitest';
import { parseJson, stringifyJson } from './json';

afterEach(() => vi.restoreAllMocks());

describe('parseJson', () => {
  it('keeps whole numbers beyond ±(2^53 − 1) exact as BigInt, at any depth', () => {
    expect(
      parseJson(
        '{"id":12345678901234567890,"neg":-1180591620717411303424,"raw":{"hash":[9007199254740993]}}',
      ),
    ).toEqual({
      id: 12345678901234567890n,
      neg: -1180591620717411303424n,
      raw: { hash: [9007199254740993n] },
    });
  });

  it('keeps safe whole numbers, decimals and digits in strings as they are', () => {
    expect(
      parseJson(
        '{"max":9007199254740991,"min":-9007199254740991,"f":1.2345678901234567e+30,"s":"12345678901234567890"}',
      ),
    ).toEqual({
      max: 9007199254740991,
      min: -9007199254740991,
      f: 1.2345678901234567e30,
      s: '12345678901234567890',
    });
  });

  it('parses without a reviver when the text has no run of 16 digits', () => {
    const parse = vi.spyOn(JSON, 'parse');

    expect(parseJson('{"n":123456789012345,"f":0.5}')).toEqual({ n: 123456789012345, f: 0.5 });

    expect(parse).toHaveBeenCalledTimes(1);
    expect(parse.mock.calls[0]).toHaveLength(1);
  });

  it('rounds, rather than throws, when the reviver gets no source text', () => {
    const parse = JSON.parse;
    vi.spyOn(JSON, 'parse').mockImplementation((text: string, reviver?: Reviver): unknown =>
      parse(text, reviver && ((key, value) => reviver(key, value))),
    );

    expect(parseJson('{"id":12345678901234567890}')).toEqual({ id: 12345678901234567000 });
  });

  it('throws on text that is not JSON', () => {
    expect(() => parseJson('{"id":12345678901234567890')).toThrow(SyntaxError);
  });
});

type Reviver = (key: string, value: unknown) => unknown;

describe('stringifyJson', () => {
  it('writes a BigInt as a plain JSON number, at any depth', () => {
    expect(stringifyJson({ id: 12345678901234567890n, raw: [{ hash: -9007199254740993n }] })).toBe(
      '{"id":12345678901234567890,"raw":[{"hash":-9007199254740993}]}',
    );
  });

  it('round-trips through parseJson', () => {
    const text = '{"id":12345678901234567890,"n":42}';
    expect(stringifyJson(parseJson(text))).toBe(text);
  });

  it('applies a replacer and indentation as JSON.stringify does', () => {
    expect(
      stringifyJson(
        { a: 'x', id: 12345678901234567890n },
        (_key, v: unknown) => (v === 'x' ? 'y' : v),
        2,
      ),
    ).toBe('{\n  "a": "y",\n  "id": 12345678901234567890\n}');
  });

  it('gives undefined for undefined, as JSON.stringify does', () => {
    expect(stringifyJson(undefined)).toBeUndefined();
  });
});
