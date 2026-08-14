import { OPENLIT_CONTEXTS_TABLE_NAME } from '@/lib/platform/context/table-details';

describe('context table-details', () => {
  it('OPENLIT_CONTEXTS_TABLE_NAME is a non-empty string', () => {
    expect(typeof OPENLIT_CONTEXTS_TABLE_NAME).toBe('string');
    expect(OPENLIT_CONTEXTS_TABLE_NAME.length).toBeGreaterThan(0);
  });

  it('OPENLIT_CONTEXTS_TABLE_NAME has the correct value', () => {
    expect(OPENLIT_CONTEXTS_TABLE_NAME).toBe('openlit_contexts');
  });
});
