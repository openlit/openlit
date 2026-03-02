import {
  escapeSingleQuotes,
  normalizeWidgetToServer,
  normalizeWidgetToClient,
  unsanitizeWidget,
} from '@/helpers/server/widget';

describe('escapeSingleQuotes', () => {
  it('wraps single-quoted substrings in double single-quotes', () => {
    expect(escapeSingleQuotes("hello 'world'")).toBe("hello ''world''");
  });

  it('returns the string unchanged when there are no single quotes', () => {
    expect(escapeSingleQuotes('no quotes here')).toBe('no quotes here');
  });

  it('handles empty string', () => {
    expect(escapeSingleQuotes('')).toBe('');
  });

  it('handles multiple quoted substrings', () => {
    expect(escapeSingleQuotes("'foo' and 'bar'")).toBe("''foo'' and ''bar''");
  });

  it('doubles already-doubled adjacent single quotes', () => {
    // The regex matches each '' pair and replaces it with ''''
    const input = "it''s fine";
    expect(escapeSingleQuotes(input)).toBe("it''''s fine");
  });
});

describe('normalizeWidgetToServer', () => {
  it('serializes properties to JSON string', () => {
    const widget = {
      id: 'w1',
      properties: { width: 100, height: 200 },
      config: { query: 'SELECT 1' },
    } as any;
    const result = normalizeWidgetToServer(widget);
    expect(result.properties).toBe(JSON.stringify({ width: 100, height: 200 }));
  });

  it('serializes config to JSON string', () => {
    const widget = {
      id: 'w1',
      properties: { x: 1 },
      config: { query: 'SELECT 1' },
    } as any;
    const result = normalizeWidgetToServer(widget);
    expect(result.config).toBe(JSON.stringify({ query: 'SELECT 1' }));
  });

  it('preserves null properties as-is', () => {
    const widget = { id: 'w1', properties: null, config: null } as any;
    const result = normalizeWidgetToServer(widget);
    expect(result.properties).toBeNull();
    expect(result.config).toBeNull();
  });

  it('preserves other widget fields', () => {
    const widget = {
      id: 'w1',
      name: 'My Widget',
      properties: {},
      config: {},
    } as any;
    const result = normalizeWidgetToServer(widget);
    expect(result.id).toBe('w1');
    expect(result.name).toBe('My Widget');
  });
});

describe('normalizeWidgetToClient', () => {
  it('parses JSON string properties into object', () => {
    const widget = {
      id: 'w1',
      properties: '{"width":100}',
      config: '{"query":"SELECT 1"}',
    } as any;
    const result = normalizeWidgetToClient(widget);
    expect(result.properties).toEqual({ width: 100 });
  });

  it('parses JSON string config into object', () => {
    const widget = {
      id: 'w1',
      properties: '{"x":1}',
      config: '{"query":"SELECT 1"}',
    } as any;
    const result = normalizeWidgetToClient(widget);
    expect(result.config).toEqual({ query: 'SELECT 1' });
  });

  it('preserves other widget fields', () => {
    const widget = {
      id: 'w2',
      name: 'Test',
      properties: '{}',
      config: '{}',
    } as any;
    const result = normalizeWidgetToClient(widget);
    expect(result.id).toBe('w2');
    expect(result.name).toBe('Test');
  });
});

describe('unsanitizeWidget', () => {
  it('replaces actual newlines with escaped newlines in config', () => {
    const widget = { id: 'w1', config: 'SELECT\n1', properties: '' } as any;
    const result = unsanitizeWidget(widget);
    expect(result.config).toBe('SELECT\\n1');
  });

  it('replaces tabs with escaped tabs in config', () => {
    const widget = { id: 'w1', config: 'SELECT\t1', properties: '' } as any;
    const result = unsanitizeWidget(widget);
    expect(result.config).toBe('SELECT\\t1');
  });

  it('does not modify properties', () => {
    const widget = { id: 'w1', config: '', properties: 'test\nvalue' } as any;
    const result = unsanitizeWidget(widget);
    expect(result.properties).toBe('test\nvalue');
  });

  it('leaves config unchanged when there are no newlines or tabs', () => {
    const widget = { id: 'w1', config: 'SELECT 1 FROM table', properties: '' } as any;
    const result = unsanitizeWidget(widget);
    expect(result.config).toBe('SELECT 1 FROM table');
  });
});
