import {
  OPENLIT_PROVIDERS_TABLE_NAME,
  OPENLIT_PROVIDER_MODELS_TABLE_NAME,
} from '@/lib/platform/providers/table-details';

describe('providers table-details', () => {
  it('exports the correct providers table name', () => {
    expect(OPENLIT_PROVIDERS_TABLE_NAME).toBe('openlit_providers');
  });

  it('exports the correct provider models table name', () => {
    expect(OPENLIT_PROVIDER_MODELS_TABLE_NAME).toBe('openlit_provider_models');
  });
});
