import { parseQueryStringToObject, constructURL } from '@/utils/parser';

describe('parseQueryStringToObject', () => {
  it('parses a simple query string into an object', () => {
    expect(parseQueryStringToObject('a=1&b=2')).toEqual({ a: '1', b: '2' });
  });

  it('returns an empty object for an empty string', () => {
    expect(parseQueryStringToObject('')).toEqual({});
  });

  it('parses a single key-value pair', () => {
    expect(parseQueryStringToObject('key=value')).toEqual({ key: 'value' });
  });

  it('handles multiple params', () => {
    const result = parseQueryStringToObject('name=Alice&age=30&active=true');
    expect(result).toEqual({ name: 'Alice', age: '30', active: 'true' });
  });

  it('handles params with encoded characters', () => {
    const result = parseQueryStringToObject('q=hello%20world');
    expect(result.q).toBe('hello%20world');
  });
});

describe('constructURL', () => {
  it('prepends http:// to a bare hostname', () => {
    expect(constructURL('localhost', '8080')).toBe('http://localhost:8080');
  });

  it('keeps http:// prefix if already present', () => {
    expect(constructURL('http://localhost', '8080')).toBe('http://localhost:8080');
  });

  it('keeps https:// prefix if already present', () => {
    expect(constructURL('https://example.com', '443')).toBe('https://example.com:443');
  });

  it('omits port when port is empty string', () => {
    expect(constructURL('https://example.com', '')).toBe('https://example.com');
  });

  it('handles domain without protocol and without port', () => {
    expect(constructURL('example.com', '')).toBe('http://example.com');
  });

  it('constructs URL with domain and port', () => {
    expect(constructURL('example.com', '3000')).toBe('http://example.com:3000');
  });
});
