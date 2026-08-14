jest.mock('@/lib/platform/common', () => ({
  dataCollector: jest.fn(),
}));
jest.mock('@/utils/sanitizer', () => ({
  __esModule: true,
  default: { sanitizeValue: jest.fn((v: string) => v) },
}));

import {
  getCustomModels,
  getCustomModelsGroupedByProvider,
  createCustomModel,
  updateCustomModel,
  deleteCustomModel,
  getCustomModelsForProvider,
} from '@/lib/platform/providers/models-service';
import { dataCollector } from '@/lib/platform/common';

const mockModel = {
  id: 'uuid-1',
  model_id: 'gpt-4o-custom',
  provider: 'openai',
  displayName: 'GPT-4o Custom',
  modelType: 'chat',
  contextWindow: 128000,
  inputPricePerMToken: 2.5,
  outputPricePerMToken: 10.0,
  capabilities: ['streaming'],
  isDefault: false,
};

const Sanitizer = require('@/utils/sanitizer').default;

beforeEach(() => {
  jest.resetAllMocks();
  // Re-apply sanitizer mock after resetAllMocks
  Sanitizer.sanitizeValue.mockImplementation((v: string) => v);
});

describe('getCustomModels', () => {
  it('returns all models when no provider filter', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ data: [mockModel] });

    const result = await getCustomModels('user-1', 'db-1');

    expect(result.data).toHaveLength(1);
    expect(result.data![0].model_id).toBe('gpt-4o-custom');
    // Query should NOT have a WHERE clause for provider
    expect(dataCollector).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.not.stringContaining("provider = "),
      }),
      'query',
      'db-1'
    );
  });

  it('filters by provider when specified', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ data: [mockModel] });

    await getCustomModels('user-1', 'db-1', 'openai');

    expect(dataCollector).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.stringContaining("provider = 'openai'"),
      }),
      'query',
      'db-1'
    );
  });

  it('returns error on DB failure', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: 'DB error' });

    const result = await getCustomModels('user-1', 'db-1');
    expect(result.err).toBe('DB error');
  });
});

describe('getCustomModelsGroupedByProvider', () => {
  it('groups models by provider', async () => {
    const models = [
      { ...mockModel, provider: 'openai' },
      { ...mockModel, id: 'uuid-2', provider: 'anthropic', model_id: 'claude-3' },
    ];
    (dataCollector as jest.Mock).mockResolvedValue({ data: models });

    const result = await getCustomModelsGroupedByProvider('user-1', 'db-1');

    expect(result.data).toBeDefined();
    expect(Object.keys(result.data!)).toContain('openai');
    expect(Object.keys(result.data!)).toContain('anthropic');
    expect(result.data!['openai']).toHaveLength(1);
  });

  it('returns error when underlying getCustomModels fails', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: 'fail' });

    const result = await getCustomModelsGroupedByProvider('user-1', 'db-1');

    expect(result.err).toBe('fail');
  });

  it('handles empty data', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ data: [] });

    const result = await getCustomModelsGroupedByProvider('user-1', 'db-1');

    expect(result.data).toEqual({});
  });
});

describe('createCustomModel', () => {
  it('validates required fields', async () => {
    const result = await createCustomModel('user-1', 'db-1', {
      provider: '',
      model_id: '',
      displayName: '',
    });
    expect(result.err).toContain('required');
    expect(dataCollector).not.toHaveBeenCalled();
  });

  it('inserts and returns the new model', async () => {
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ err: null }) // insert
      .mockResolvedValueOnce({ data: [mockModel] }); // select

    const result = await createCustomModel('user-1', 'db-1', {
      provider: 'openai',
      model_id: 'gpt-4o-custom',
      displayName: 'GPT-4o Custom',
    });

    expect(result.data).toBeDefined();
    expect(result.data!.model_id).toBe('gpt-4o-custom');
    // INSERT call should use 'insert' type
    expect(dataCollector).toHaveBeenCalledWith(
      expect.objectContaining({ table: 'openlit_provider_models' }),
      'insert',
      'db-1'
    );
  });

  it('returns error when insert fails', async () => {
    (dataCollector as jest.Mock).mockResolvedValueOnce({ err: 'insert failed' });

    const result = await createCustomModel('user-1', 'db-1', {
      provider: 'openai',
      model_id: 'm',
      displayName: 'M',
    });

    expect(result.err).toBe('insert failed');
  });

  it('returns error when post-insert select fails', async () => {
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ err: null }) // insert succeeds
      .mockResolvedValueOnce({ err: 'select failed' });

    const result = await createCustomModel('user-1', 'db-1', {
      provider: 'openai',
      model_id: 'm',
      displayName: 'M',
    });

    expect(result.err).toBe('select failed');
  });
});

describe('updateCustomModel', () => {
  it('builds an ALTER TABLE UPDATE query', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: null });

    const result = await updateCustomModel('user-1', 'db-1', 'gpt-4o-custom', {
      displayName: 'Renamed Model',
      contextWindow: 256000,
    });

    expect(result.data).toBe(true);
    expect(dataCollector).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.stringContaining('ALTER TABLE'),
      }),
      'exec',
      'db-1'
    );
  });

  it('still runs update when only updated_at changes (empty input)', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: null });

    const result = await updateCustomModel('user-1', 'db-1', 'id', {});
    // updated_at = now() is always appended, so the query runs even with empty input
    expect(result.data).toBe(true);
    expect(dataCollector).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.stringContaining('updated_at = now()'),
      }),
      'exec',
      'db-1'
    );
  });

  it('updates all optional fields together', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: null });

    const result = await updateCustomModel('user-1', 'db-1', 'id', {
      displayName: 'New',
      modelType: 'chat',
      contextWindow: 8000,
      inputPricePerMToken: 1.5,
      outputPricePerMToken: 3.0,
      capabilities: ['streaming', 'vision'],
    });

    expect(result.data).toBe(true);
    expect(dataCollector).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.stringMatching(
          /display_name.*model_type.*context_window.*capabilities/s
        ),
      }),
      'exec',
      'db-1'
    );
  });

  it('returns error when ALTER UPDATE fails', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: 'alter failed' });

    const result = await updateCustomModel('user-1', 'db-1', 'id', {
      displayName: 'X',
    });

    expect(result.err).toBe('alter failed');
  });
});

describe('deleteCustomModel', () => {
  it('deletes by model id', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: null });

    const result = await deleteCustomModel('user-1', 'db-1', 'gpt-4o-custom');
    expect(result.data).toBe(true);
    expect(dataCollector).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.stringContaining('DELETE FROM'),
      }),
      'exec',
      'db-1'
    );
  });

  it('returns error on DELETE failure', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: 'delete failed' });

    const result = await deleteCustomModel('user-1', 'db-1', 'id');

    expect(result.err).toBe('delete failed');
  });
});

describe('getCustomModelsForProvider', () => {
  it('returns models in ModelMetadata format', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ data: [mockModel] });

    const result = await getCustomModelsForProvider('user-1', 'db-1', 'openai');

    expect(result.data).toHaveLength(1);
    expect(result.data![0].id).toBe('gpt-4o-custom');
    expect(result.data![0]).not.toHaveProperty('model_id');
  });

  it('returns error when underlying getCustomModels fails', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: 'fail' });

    const result = await getCustomModelsForProvider('user-1', 'db-1', 'openai');

    expect(result.err).toBe('fail');
  });
});
