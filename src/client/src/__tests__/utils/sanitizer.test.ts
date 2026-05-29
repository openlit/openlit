import Sanitizer from '@/utils/sanitizer';

describe('Sanitizer.sanitizeValue', () => {
  it('returns null as-is', () => {
    expect(Sanitizer.sanitizeValue(null)).toBeNull();
  });

  it('returns undefined as-is', () => {
    expect(Sanitizer.sanitizeValue(undefined)).toBeUndefined();
  });

  it('returns booleans unchanged', () => {
    expect(Sanitizer.sanitizeValue(true)).toBe(true);
    expect(Sanitizer.sanitizeValue(false)).toBe(false);
  });

  it('returns plain strings without modification', () => {
    expect(Sanitizer.sanitizeValue('hello')).toBe('hello');
  });

  it('escapes single quotes in strings with backslash', () => {
    const result = Sanitizer.sanitizeValue("O'Brien");
    // sqlstring escapes single quotes to backslash-quote
    expect(result).toBe("O\\'Brien");
  });

  it('escapes SQL injection attempts in strings', () => {
    const input = "'; DROP TABLE users; --";
    const result = Sanitizer.sanitizeValue(input);
    // The result should differ from the original (injection characters are escaped)
    expect(result).not.toBe(input);
    expect(typeof result).toBe('string');
  });

  it('handles numbers by escaping them', () => {
    const result = Sanitizer.sanitizeValue(42);
    // sqlstring.escape returns numbers as their value, possibly as string
    expect(String(result)).toBe('42');
  });

  it('handles empty string', () => {
    expect(Sanitizer.sanitizeValue('')).toBe('');
  });
});

describe('Sanitizer.sanitizeObject', () => {
  it('sanitizes string values in a flat object', () => {
    const input = { name: "Alice", message: "O'Brien" };
    const result = Sanitizer.sanitizeObject(input);
    expect(result.name).toBe('Alice');
    expect(result.message).toBe("O\\'Brien");
  });

  it('preserves boolean values', () => {
    const input = { active: true, disabled: false };
    const result = Sanitizer.sanitizeObject(input);
    expect(result.active).toBe(true);
    expect(result.disabled).toBe(false);
  });

  it('sanitizes nested objects recursively', () => {
    const input = { user: { name: "Bob's" } };
    const result = Sanitizer.sanitizeObject(input);
    expect(result.user.name).toBe("Bob\\'s");
  });

  it('sanitizes arrays of strings', () => {
    const input = { tags: ["hello", "O'Brien"] };
    const result = Sanitizer.sanitizeObject(input);
    expect(result.tags[0]).toBe('hello');
    expect(result.tags[1]).toBe("O\\'Brien");
  });

  it('sanitizes arrays of objects', () => {
    const input = { items: [{ label: "Tom's" }] };
    const result = Sanitizer.sanitizeObject(input);
    expect(result.items[0].label).toBe("Tom\\'s");
  });

  it('returns an object with the same keys', () => {
    const input = { a: 'foo', b: 'bar' };
    const result = Sanitizer.sanitizeObject(input);
    expect(Object.keys(result)).toEqual(['a', 'b']);
  });
});
