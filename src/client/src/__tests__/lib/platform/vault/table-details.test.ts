import { OPENLIT_VAULT_TABLE_NAME } from '@/lib/platform/vault/table-details';

describe('vault table-details', () => {
  it('exports the correct vault table name', () => {
    expect(OPENLIT_VAULT_TABLE_NAME).toBe('openlit_vault');
  });
});
