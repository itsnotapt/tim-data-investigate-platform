import { isEmpty } from './isEmpty';

describe('isEmpty', () => {
  it.each([
    ['', true],
    [undefined, true],
    [null, true],
    [[], true],
    [{}, true],
    [Object.create(null), true],
    [' ', false],
    [0, false],
    [false, false],
    ['a', false],
    [[0], false],
    [{ a: undefined }, false],
    [new Date(0), false],
  ])('isEmpty(%j) = %s', (v, expected) => {
    expect(isEmpty(v)).toBe(expected);
  });
});
