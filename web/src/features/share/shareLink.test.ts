import { describe, expect, it } from 'vitest';
import {
  buildShareUrl,
  decodeShareParams,
  encodeShareParams,
  sanitizeShareParams,
} from './shareLink';

const template = {
  cluster: 'c',
  query: 'q',
  summary: 's',
  params: { user: { default: 'def' }, other: { default: 'o' } },
  fields: { ip: { type: 'match', regex: '^Ip' } },
} as never;

describe('share link', () => {
  it('round-trips emoji and non-Latin1 params', () => {
    const params = { user: 'héllo 😀 日本語', list: ['a+b/c', '😀'] };
    const p = encodeShareParams(params);
    expect(p).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeShareParams(p)).toEqual(params);
  });

  it('throws on garbage', () => {
    expect(() => decodeShareParams('%%%')).toThrow();
    expect(() => decodeShareParams(btoa('not json'))).toThrow();
  });

  it('builds a hash link with execute=0', () => {
    const url = buildShareUrl('t 1', { a: 1 }, false, 'https://h/app/');
    expect(url).toMatch(/^https:\/\/h\/app\/#\/share\/t%201\?p=[\w-]+&execute=0$/);
    expect(buildShareUrl('t', {}, true, 'https://h/')).toMatch(/&execute=1$/);
  });

  it('sanitizes against the template', () => {
    expect(
      sanitizeShareParams(template, { user: 'bob', evil: 'x', __proto__: { y: 1 }, ip: 'v' }),
    ).toEqual({ user: 'bob', other: 'o', ip: [{ column: '', value: 'v' }] });
    const keep = [{ column: 'IpA', value: '1.1.1.1' }];
    expect(sanitizeShareParams(template, { ip: keep })?.['ip']).toEqual(keep);
    expect(sanitizeShareParams(template, {})).toEqual({ user: 'def', other: 'o' });
  });

  it('rejects non-object payloads', () => {
    for (const bad of [null, 'x', 3, [1]]) expect(sanitizeShareParams(template, bad)).toBeNull();
  });
});
