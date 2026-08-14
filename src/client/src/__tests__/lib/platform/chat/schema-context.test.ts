import { getChatSystemPrompt } from '@/lib/platform/chat/schema-context';

describe('getChatSystemPrompt', () => {
  const prompt = getChatSystemPrompt();

  it('returns a non-empty string', () => {
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(100);
  });

  it('includes the role description', () => {
    expect(prompt).toContain('AI assistant for OpenLIT');
  });

  it('includes otel_traces table schema', () => {
    expect(prompt).toContain('otel_traces');
    expect(prompt).toContain('Timestamp');
    expect(prompt).toContain('SpanAttributes');
    expect(prompt).toContain('ResourceAttributes');
  });

  it('includes metrics table schemas', () => {
    expect(prompt).toContain('otel_metrics_gauge');
    expect(prompt).toContain('otel_metrics_sum');
    expect(prompt).toContain('otel_metrics_histogram');
  });

  it('includes common SpanAttributes keys', () => {
    expect(prompt).toContain('gen_ai.system');
    expect(prompt).toContain('gen_ai.request.model');
    expect(prompt).toContain('gen_ai.usage.cost');
    expect(prompt).toContain('gen_ai.usage.input_tokens');
  });

  it('includes Mustache template pattern requirement', () => {
    expect(prompt).toContain('{{filter.timeLimit.start}}');
    expect(prompt).toContain('{{filter.timeLimit.end}}');
  });

  it('includes tool descriptions', () => {
    expect(prompt).toContain('create_rule');
    expect(prompt).toContain('create_context');
    expect(prompt).toContain('create_prompt');
    expect(prompt).toContain('create_vault_secret');
    expect(prompt).toContain('create_custom_model');
  });

  it('includes entity links section', () => {
    expect(prompt).toContain('Entity Links');
    expect(prompt).toContain('/rule-engine/{id}');
    expect(prompt).toContain('/context/{id}');
    expect(prompt).toContain('/prompt-hub/{id}');
  });

  it('includes dashboard generation section', () => {
    expect(prompt).toContain('Dashboard Generation');
    expect(prompt).toContain('```dashboard');
    expect(prompt).toContain('STAT_CARD');
    expect(prompt).toContain('BAR_CHART');
    expect(prompt).toContain('LINE_CHART');
    expect(prompt).toContain('PIE_CHART');
    expect(prompt).toContain('AREA_CHART');
  });

  it('includes widget property documentation', () => {
    expect(prompt).toContain('properties connect query columns');
    expect(prompt).toContain('"value": "0.');
    expect(prompt).toContain('"xAxis"');
    expect(prompt).toContain('"labelPath"');
    expect(prompt).toContain('"yAxes"');
  });

  it('includes example queries with CTE pattern', () => {
    expect(prompt).toContain('parseDateTimeBestEffort');
    expect(prompt).toContain('start_time');
    expect(prompt).toContain('end_time');
  });

  it('includes instant creation guideline', () => {
    expect(prompt).toContain('IMMEDIATELY');
    expect(prompt).toContain('Do NOT ask for confirmation');
  });
});
