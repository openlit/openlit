import { jsonStringify, jsonParse } from '@/utils/json';

describe('jsonStringify', () => {
  it('serializes a plain object', () => {
    expect(jsonStringify({ a: 1, b: 'hello' })).toBe('{"a":1,"b":"hello"}');
  });

  it('serializes an array', () => {
    expect(jsonStringify([1, 2, 3])).toBe('[1,2,3]');
  });

  it('serializes null', () => {
    expect(jsonStringify(null)).toBe('null');
  });

  it('serializes a number', () => {
    expect(jsonStringify(42)).toBe('42');
  });

  it('serializes a string', () => {
    expect(jsonStringify('hello')).toBe('"hello"');
  });

  it('returns empty string for a circular reference', () => {
    const obj: any = { a: 1 };
    obj.self = obj;
    expect(jsonStringify(obj)).toBe('');
  });
});

describe('jsonParse', () => {
  it('parses a valid JSON object string', () => {
    expect(jsonParse('{"a":1,"b":"hello"}')).toEqual({ a: 1, b: 'hello' });
  });

  it('parses a valid JSON array string', () => {
    expect(jsonParse('[1,2,3]')).toEqual([1, 2, 3]);
  });

  it('parses null', () => {
    expect(jsonParse('null')).toBeNull();
  });

  it('returns undefined for invalid JSON', () => {
    expect(jsonParse('not valid json')).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(jsonParse('')).toBeUndefined();
  });

  it('parses nested objects', () => {
    expect(jsonParse('{"outer":{"inner":42}}')).toEqual({ outer: { inner: 42 } });
  });
});
