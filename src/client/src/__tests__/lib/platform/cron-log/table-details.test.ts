import { OPENLIT_CRON_LOG_TABLE_NAME } from '@/lib/platform/cron-log/table-details';

describe('cron-log table-details', () => {
  it('exports the correct cron log table name', () => {
    expect(typeof OPENLIT_CRON_LOG_TABLE_NAME).toBe('string');
    expect(OPENLIT_CRON_LOG_TABLE_NAME.length).toBeGreaterThan(0);
  });
});
