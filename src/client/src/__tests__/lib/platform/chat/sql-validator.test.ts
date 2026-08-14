import { validateSQL, extractSQLFromResponse } from '@/lib/platform/chat/sql-validator';

describe('validateSQL', () => {
  it('rejects empty query', () => {
    const result = validateSQL('');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Empty query');
  });

  it('rejects null/undefined', () => {
    expect(validateSQL(null as any).valid).toBe(false);
    expect(validateSQL(undefined as any).valid).toBe(false);
  });

  it('accepts valid SELECT query', () => {
    const result = validateSQL('SELECT COUNT(*) FROM otel_traces LIMIT 10');
    expect(result.valid).toBe(true);
    expect(result.query).toContain('SELECT COUNT(*)');
  });

  it('accepts WITH...SELECT (CTE)', () => {
    const result = validateSQL("WITH parseDateTimeBestEffort('2025-01-01') AS start_time SELECT COUNT(*) FROM otel_traces LIMIT 10");
    expect(result.valid).toBe(true);
  });

  it('rejects INSERT', () => {
    const result = validateSQL("INSERT INTO otel_traces VALUES ('a')");
    expect(result.valid).toBe(false);
    expect(result.error).toContain('forbidden operation');
  });

  it('rejects DROP', () => {
    const result = validateSQL('DROP TABLE otel_traces');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('forbidden operation');
  });

  it('rejects DELETE', () => {
    const result = validateSQL('DELETE FROM otel_traces WHERE 1=1');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('forbidden operation');
  });

  it('rejects ALTER', () => {
    const result = validateSQL('ALTER TABLE otel_traces ADD COLUMN x String');
    expect(result.valid).toBe(false);
  });

  it('rejects CREATE', () => {
    const result = validateSQL('CREATE TABLE bad_table (id Int)');
    expect(result.valid).toBe(false);
  });

  it('rejects non-allowed tables', () => {
    const result = validateSQL('SELECT * FROM openlit_vault LIMIT 10');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('not allowed');
  });

  it('allows otel_traces', () => {
    expect(validateSQL('SELECT * FROM otel_traces LIMIT 10').valid).toBe(true);
  });

  it('allows otel_metrics_gauge', () => {
    expect(validateSQL('SELECT * FROM otel_metrics_gauge LIMIT 10').valid).toBe(true);
  });

  it('allows otel_metrics_sum', () => {
    expect(validateSQL('SELECT * FROM otel_metrics_sum LIMIT 10').valid).toBe(true);
  });

  it('allows otel_metrics_histogram', () => {
    expect(validateSQL('SELECT * FROM otel_metrics_histogram LIMIT 10').valid).toBe(true);
  });

  it('appends LIMIT 1000 if missing', () => {
    const result = validateSQL('SELECT * FROM otel_traces');
    expect(result.valid).toBe(true);
    expect(result.query).toContain('LIMIT 1000');
  });

  it('preserves existing LIMIT', () => {
    const result = validateSQL('SELECT * FROM otel_traces LIMIT 50');
    expect(result.valid).toBe(true);
    expect(result.query).toContain('LIMIT 50');
  });

  it('caps LIMIT above 10000 to 1000', () => {
    const result = validateSQL('SELECT * FROM otel_traces LIMIT 99999');
    expect(result.valid).toBe(true);
    expect(result.query).toContain('LIMIT 1000');
  });

  it('strips markdown code block markers', () => {
    const result = validateSQL('```sql\nSELECT 1 FROM otel_traces LIMIT 1\n```');
    expect(result.valid).toBe(true);
    expect(result.query).not.toContain('```');
  });

  it('strips trailing semicolons', () => {
    const result = validateSQL('SELECT 1 FROM otel_traces LIMIT 1;');
    expect(result.valid).toBe(true);
    expect(result.query).not.toContain(';');
  });
});

describe('extractSQLFromResponse', () => {
  it('extracts SQL from markdown response', () => {
    const response = 'Here is the query:\n```sql\nSELECT COUNT(*) FROM otel_traces\n```\nThis counts traces.';
    const blocks = extractSQLFromResponse(response);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain('SELECT COUNT(*)');
  });

  it('extracts multiple SQL blocks', () => {
    const response = '```sql\nSELECT 1\n```\nAnd also:\n```sql\nSELECT 2\n```';
    const blocks = extractSQLFromResponse(response);
    expect(blocks).toHaveLength(2);
  });

  it('returns empty array when no SQL blocks', () => {
    const blocks = extractSQLFromResponse('No SQL here');
    expect(blocks).toHaveLength(0);
  });
});
