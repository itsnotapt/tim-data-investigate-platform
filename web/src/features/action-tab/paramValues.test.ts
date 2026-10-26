import { parseParamText } from './paramValues';

describe('parseParamText', () => {
  it('gives a number param a number within ±(2^53 − 1)', () => {
    expect(parseParamText('number', ' 9007199254740991 ')).toEqual({ value: 9007199254740991 });
    expect(parseParamText('number', '-42')).toEqual({ value: -42 });
    expect(parseParamText('number', '1.5')).toEqual({ value: 1.5 });
  });

  it('keeps a whole number beyond ±(2^53 − 1) in a number param exact', () => {
    expect(parseParamText('number', '12345678901234567890')).toEqual({
      value: 12345678901234567890n,
    });
    expect(parseParamText('number', '-9007199254740993')).toEqual({ value: -9007199254740993n });
  });

  it('refuses a number param that is not a number', () => {
    expect(parseParamText('number', '12a')).toEqual({ error: 'Must be a number' });
  });

  it('keeps a whole number beyond ±(2^53 − 1) inside a json param exact', () => {
    expect(parseParamText('json', '[{"id": 12345678901234567890, "n": 1}]')).toEqual({
      value: [{ id: 12345678901234567890n, n: 1 }],
    });
  });

  it('refuses a json param that is not JSON', () => {
    expect(parseParamText('json', '{')).toEqual({ error: 'Must be JSON' });
  });
});
