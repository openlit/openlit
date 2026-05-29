import { objectKeys, objectEntries } from '@/utils/object';

describe('objectKeys', () => {
  it('returns keys of an object', () => {
    const obj = { a: 1, b: 2, c: 3 };
    expect(objectKeys(obj)).toEqual(['a', 'b', 'c']);
  });

  it('returns an empty array for an empty object', () => {
    expect(objectKeys({})).toEqual([]);
  });

  it('returns typed keys', () => {
    const obj = { name: 'Alice', age: 30 };
    const keys = objectKeys(obj);
    expect(keys).toContain('name');
    expect(keys).toContain('age');
    expect(keys).toHaveLength(2);
  });

  it('handles objects with symbol keys (only returns string keys)', () => {
    const obj = { x: 1, y: 2 };
    const keys = objectKeys(obj);
    expect(keys).toEqual(['x', 'y']);
  });
});

describe('objectEntries', () => {
  it('returns [key, value] pairs of an object', () => {
    const obj = { a: 1, b: 2 };
    expect(objectEntries(obj)).toEqual([['a', 1], ['b', 2]]);
  });

  it('returns an empty array for an empty object', () => {
    expect(objectEntries({})).toEqual([]);
  });

  it('handles objects with mixed value types', () => {
    const obj = { name: 'Alice', active: true, count: 42 };
    const entries = objectEntries(obj);
    expect(entries).toHaveLength(3);
    expect(entries).toContainEqual(['name', 'Alice']);
    expect(entries).toContainEqual(['active', true]);
    expect(entries).toContainEqual(['count', 42]);
  });
});
