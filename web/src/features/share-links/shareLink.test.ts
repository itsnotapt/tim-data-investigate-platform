import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyShareLink, rowParam, shareLink } from './shareLink';

const clipboard = (writeText: (text: string) => Promise<void>) =>
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('shareLink', () => {
  it('links to a run, or to one of its rows', () => {
    expect(shareLink('r 1')).toBe('http://localhost:3000/#/runs/r%201');
    expect(shareLink('r1', 0)).toBe('http://localhost:3000/#/runs/r1?row=0');
  });
});

describe('rowParam', () => {
  it.each([
    ['0', 0],
    ['12', 12],
    [null, null],
    ['', null],
    ['-1', null],
    ['1.5', null],
    ['1e3', null],
    ['two', null],
  ])('reads %j as %j', (value, row) => {
    expect(rowParam(value)).toBe(row);
  });
});

describe('copyShareLink', () => {
  it('copies the link and says what it links to', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    clipboard(writeText);
    const notify = vi.fn();
    await copyShareLink('r1', 2, notify);
    await copyShareLink('r1', null, notify);
    expect(writeText.mock.calls).toEqual([
      ['http://localhost:3000/#/runs/r1?row=2'],
      ['http://localhost:3000/#/runs/r1'],
    ]);
    expect(notify.mock.calls).toEqual([
      ['Copied a link to this row'],
      ['Copied a link to this result'],
    ]);
  });

  it('says when the link could not be copied', async () => {
    clipboard(() => Promise.reject(new Error('Denied')));
    const notify = vi.fn();
    await copyShareLink('r1', null, notify);
    expect(notify).toHaveBeenCalledExactlyOnceWith("Couldn't copy the link");
  });
});
