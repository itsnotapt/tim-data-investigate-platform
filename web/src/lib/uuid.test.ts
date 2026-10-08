import { generateUuid } from './uuid';

describe('generateUuid', () => {
  it('returns RFC 4122 v4 format and is unique', () => {
    const re = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    const a = generateUuid();
    expect(a).toMatch(re);
    expect(generateUuid()).not.toBe(a);
  });
});
