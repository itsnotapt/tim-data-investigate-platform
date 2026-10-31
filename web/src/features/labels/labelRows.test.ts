import { describe, expect, it } from 'vitest';
import { rowId } from './labelRows';

describe('rowId', () => {
  it('is the Id column’s string as is', () => {
    expect(rowId({ Host: 'h-1', EventId: 'e 7' }, 'EventId')).toBe('e 7');
  });

  it('is any other value as JSON', () => {
    expect(rowId({ EventId: 7 }, 'EventId')).toBe('7');
    expect(rowId({ EventId: true }, 'EventId')).toBe('true');
    expect(rowId({ Key: { b: 1, a: [2, 'x'] } }, 'Key')).toBe('{"b":1,"a":[2,"x"]}');
  });

  it('is no id without an Id column, or where its value is missing, null or empty', () => {
    expect(rowId({ EventId: 'e-1' }, null)).toBeNull();
    expect(rowId({ Host: 'h-1' }, 'EventId')).toBeNull();
    expect(rowId({ EventId: null }, 'EventId')).toBeNull();
    expect(rowId({ EventId: '' }, 'EventId')).toBeNull();
  });

  it('is no id where the value is longer than 512 characters', () => {
    expect(rowId({ EventId: 'x'.repeat(512) }, 'EventId')).toBe('x'.repeat(512));
    expect(rowId({ EventId: 'x'.repeat(513) }, 'EventId')).toBeNull();
  });
});
