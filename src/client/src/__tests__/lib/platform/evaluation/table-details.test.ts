import { OPENLIT_EVALUATION_TABLE_NAME } from '@/lib/platform/evaluation/table-details';

describe('evaluation table-details', () => {
  it('exports the correct evaluation table name', () => {
    expect(OPENLIT_EVALUATION_TABLE_NAME).toBe('openlit_evaluation');
  });
});
