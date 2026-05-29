import {
  unescapeString,
  convertToTitleCase,
  escapeHtml,
  escapeEmailForDisplay,
} from '@/utils/string';

describe('unescapeString', () => {
  it('replaces \\n escape sequences with actual newlines', () => {
    expect(unescapeString('hello\\nworld')).toBe('hello\nworld');
  });

  it('handles multiple \\n occurrences', () => {
    expect(unescapeString('line1\\nline2\\nline3')).toBe('line1\nline2\nline3');
  });

  it('returns string unchanged when no \\n present', () => {
    expect(unescapeString('hello world')).toBe('hello world');
  });

  it('handles empty string', () => {
    expect(unescapeString('')).toBe('');
  });

  it('does not replace actual newlines (only escaped)', () => {
    expect(unescapeString('hello\nworld')).toBe('hello\nworld');
  });
});

describe('convertToTitleCase', () => {
  it('converts underscores to spaces and capitalizes words', () => {
    expect(convertToTitleCase('hello_world')).toBe('Hello World');
  });

  it('converts hyphens to spaces and capitalizes words', () => {
    expect(convertToTitleCase('hello-world')).toBe('Hello World');
  });

  it('handles mixed separators', () => {
    expect(convertToTitleCase('foo_bar-baz')).toBe('Foo Bar Baz');
  });

  it('handles single word', () => {
    expect(convertToTitleCase('hello')).toBe('Hello');
  });

  it('handles already title-cased string', () => {
    expect(convertToTitleCase('Hello World')).toBe('Hello World');
  });

  it('handles empty string', () => {
    expect(convertToTitleCase('')).toBe('');
  });

  it('converts multi-word snake_case to Title Case', () => {
    expect(convertToTitleCase('open_telemetry_sdk')).toBe('Open Telemetry Sdk');
  });
});

describe('escapeHtml', () => {
  it('escapes HTML-sensitive characters', () => {
    expect(escapeHtml(`<script>alert('x')</script>&"`)).toBe(
      '&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;&amp;&quot;'
    );
  });
});

describe('escapeEmailForDisplay', () => {
  it('escapes unsafe email display text', () => {
    expect(escapeEmailForDisplay('"><img src=x onerror=alert(1)>@test.com')).toBe(
      '&quot;&gt;&lt;img src=x onerror=alert(1)&gt;@test.com'
    );
  });

  it('returns an empty string for missing email', () => {
    expect(escapeEmailForDisplay(null)).toBe('');
  });
});
