import { describe, expect, it } from 'vitest';
import { fillIn, titleColumns } from './titleTemplate';

describe('fillIn', () => {
  it('replaces each placeholder with its param and keeps the plain text', () => {
    expect(
      fillIn('Logons of {user} on {host}', { params: { user: 'alice', host: 'web-01' } }),
    ).toBe('Logons of alice on web-01');
  });

  it('shows a string as it is and any other value as JSON', () => {
    const params = { path: 'C:\\Windows\\cmd.exe', count: 5, live: false, filter: { a: 'b' } };
    expect(fillIn('{path} {count} {live} {filter}', { params })).toBe(
      'C:\\Windows\\cmd.exe 5 false {"a":"b"}',
    );
  });

  it('shows a connection by its name', () => {
    expect(fillIn('Hosts in {connection}', { params: { connection: 'adx-prod' } })).toBe(
      'Hosts in adx-prod',
    );
  });

  it('shows a list as up to two values, then how many more', () => {
    const fill = (users: unknown[]) => fillIn('Sign-ins for {users}', { params: { users } });
    expect(fill(['alice'])).toBe('Sign-ins for [alice]');
    expect(fill(['alice', 'bob'])).toBe('Sign-ins for [alice, bob]');
    expect(fill(['alice', 'bob', 'carol'])).toBe('Sign-ins for [alice, bob, … +1]');
    expect(fill(['alice', 'bob', 'carol', 'dave', 'erin'])).toBe('Sign-ins for [alice, bob, … +3]');
    expect(fill([1, null])).toBe('Sign-ins for [1, null]');
  });

  it.each([
    ['no value', {}],
    ['null', { host: null }],
    ['""', { host: '' }],
    ['[]', { host: [] }],
  ])('shows %s as <not set>', (_, params) => {
    expect(fillIn('Timeline of {host}', { params })).toBe('Timeline of <not set>');
  });

  describe('{row.X}', () => {
    const fill = (pivotRows?: Record<string, unknown>[]) =>
      fillIn('Tree of {row.Image}', { params: {}, ...(pivotRows && { pivotRows }) });

    it('is the value the pivot rows agree on', () => {
      expect(fill([{ Image: 'C:\\cmd.exe' }, { Image: 'C:\\cmd.exe', Host: 'web-01' }])).toBe(
        'Tree of C:\\cmd.exe',
      );
    });

    it('is their distinct values as a list when they differ', () => {
      const rows = ['a.exe', 'b.exe', 'a.exe', 'c.exe'].map((Image) => ({ Image }));
      expect(fill(rows)).toBe('Tree of [a.exe, b.exe, … +1]');
    });

    it('leaves out the rows without a value', () => {
      expect(fill([{ Image: null }, {}, { Image: 'a.exe' }])).toBe('Tree of a.exe');
    });

    it('is <not set> with no pivot rows, or none with a value', () => {
      expect(fill()).toBe('Tree of <not set>');
      expect(fill([])).toBe('Tree of <not set>');
      expect(fill([{ Image: null }, { Host: 'web-01' }])).toBe('Tree of <not set>');
    });

    it('is <not set> for a column every object has', () => {
      expect(fillIn('{row.constructor}', { params: {}, pivotRows: [{}] })).toBe('<not set>');
    });

    it('is not a param', () => {
      expect(fillIn('{row.Image}', { params: { 'row.Image': 'x' } })).toBe('<not set>');
    });
  });

  it('shows <not set> for a name that is no param, even one every object has', () => {
    expect(fillIn('{constructor} {toString}', { params: {} })).toBe('<not set> <not set>');
  });

  it('shows 0 and false, which are set', () => {
    expect(fillIn('{limit} {live}', { params: { limit: 0, live: false } })).toBe('0 false');
  });
});

describe('titleColumns', () => {
  it('is the columns the template names with row., each once', () => {
    expect(titleColumns('{row.Image} of {row.Pid} on {host}, {row.Image}')).toEqual([
      'Image',
      'Pid',
    ]);
  });

  it('is none without a template, or when it names no column', () => {
    expect(titleColumns(undefined)).toEqual([]);
    expect(titleColumns('Sign-ins for {user}')).toEqual([]);
  });
});
