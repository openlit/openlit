jest.mock('@/lib/platform/api-keys', () => ({
  getAPIKeyInfo: jest.fn(),
}));
jest.mock('@/helpers/server/prompt', () => ({
  validatePromptCompiledInput: jest.fn(),
}));
jest.mock('@/lib/platform/prompt/index', () => ({
  getSpecificPrompt: jest.fn(),
}));
jest.mock('@/lib/platform/prompt/version', () => ({
  updateDownloadDetails: jest.fn(),
}));
jest.mock('@/utils/object', () => ({
  objectEntries: jest.fn((obj: Record<string, unknown>) => Object.entries(obj)),
}));
jest.mock('@/utils/json', () => ({
  jsonParse: jest.fn((v: string) => {
    try { return JSON.parse(v); } catch { return {}; }
  }),
}));
jest.mock('@/utils/error', () => ({
  throwIfError: jest.fn((condition: boolean, msg: string) => {
    if (condition) throw new Error(msg);
  }),
}));
jest.mock('@/constants/messages', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    MALFORMED_INPUTS: 'Malformed inputs',
    NO_API_KEY: 'No API key',
    NO_PROMPT: 'No prompt',
  })),
}));
jest.mock('@/utils/string', () => ({
  unescapeString: jest.fn((s: string) => s),
}));

import { getCompiledPrompt } from '@/lib/platform/prompt/compiled';
import { getAPIKeyInfo } from '@/lib/platform/api-keys';
import { validatePromptCompiledInput } from '@/helpers/server/prompt';
import { getSpecificPrompt } from '@/lib/platform/prompt/index';
import { updateDownloadDetails } from '@/lib/platform/prompt/version';

const mockApiInfo = { id: 'key-1', databaseConfigId: 'db-1' };
// Use factory to prevent mutation of shared object across tests
const makeMockPromptData = () => ({
  promptId: 'p1',
  versionId: 'v1',
  version: '1.0.0',
  prompt: 'Hello {{name}}, your role is {{role}}',
  metaProperties: '{"key":"val"}',
  tags: '["tag1"]',
});

beforeEach(() => {
  jest.clearAllMocks();
  (validatePromptCompiledInput as jest.Mock).mockReturnValue({ success: true, err: null });
  (getAPIKeyInfo as jest.Mock).mockResolvedValue([null, mockApiInfo]);
  (getSpecificPrompt as jest.Mock).mockResolvedValue({ err: null, data: [makeMockPromptData()] });
  (updateDownloadDetails as jest.Mock).mockResolvedValue(true);
});

describe('getCompiledPrompt', () => {
  const validInput = {
    apiKey: 'ak-test',
    id: 'p1',
    name: 'my-prompt',
    version: '1.0.0',
    variables: { name: 'Alice', role: 'admin' },
  };

  it('returns compiled prompt with variables substituted', async () => {
    const result = await getCompiledPrompt(validInput as any);
    expect(result.compiledPrompt).toBe('Hello Alice, your role is admin');
  });

  it('parses metaProperties and tags', async () => {
    const result = await getCompiledPrompt(validInput as any);
    expect(result.metaProperties).toEqual({ key: 'val' });
    expect(result.tags).toEqual(['tag1']);
  });

  it('calls updateDownloadDetails with correct args', async () => {
    await getCompiledPrompt(validInput as any);
    expect(updateDownloadDetails).toHaveBeenCalledWith(
      expect.objectContaining({
        versionId: 'v1',
        promptId: 'p1',
        metaProperties: expect.objectContaining({ apiKeyId: 'key-1' }),
        downloadSource: 'api',
      }),
      'db-1'
    );
  });

  it('uses custom downloadSource when provided', async () => {
    await getCompiledPrompt({ ...validInput, downloadSource: 'sdk' } as any);
    expect(updateDownloadDetails).toHaveBeenCalledWith(
      expect.objectContaining({ downloadSource: 'sdk' }),
      'db-1'
    );
  });

  it('merges downloadMetaProperties into metaProperties for download', async () => {
    await getCompiledPrompt({ ...validInput, downloadMetaProperties: { custom: 'value' } } as any);
    expect(updateDownloadDetails).toHaveBeenCalledWith(
      expect.objectContaining({
        metaProperties: expect.objectContaining({ custom: 'value', apiKeyId: 'key-1' }),
      }),
      'db-1'
    );
  });

  it('returns raw prompt without substitution when shouldCompile=false', async () => {
    const result = await getCompiledPrompt({ ...validInput, shouldCompile: false } as any);
    expect(result.compiledPrompt).toBe('Hello {{name}}, your role is {{role}}');
  });

  it('throws MALFORMED_INPUTS when validation fails', async () => {
    (validatePromptCompiledInput as jest.Mock).mockReturnValue({ success: false, err: 'Malformed inputs' });
    await expect(getCompiledPrompt(validInput as any)).rejects.toThrow('Malformed inputs');
  });

  it('throws NO_API_KEY when getAPIKeyInfo returns an error', async () => {
    (getAPIKeyInfo as jest.Mock).mockResolvedValue(['No API key', null]);
    await expect(getCompiledPrompt(validInput as any)).rejects.toThrow('No API key');
  });

  it('throws NO_API_KEY when apiInfo has no databaseConfigId', async () => {
    (getAPIKeyInfo as jest.Mock).mockResolvedValue([null, { id: 'key-1', databaseConfigId: null }]);
    await expect(getCompiledPrompt(validInput as any)).rejects.toThrow('No API key');
  });

  it('throws when getSpecificPrompt returns error', async () => {
    (getSpecificPrompt as jest.Mock).mockResolvedValue({ err: 'DB error', data: null });
    await expect(getCompiledPrompt(validInput as any)).rejects.toThrow();
  });

  it('throws NO_PROMPT when prompt data is empty', async () => {
    (getSpecificPrompt as jest.Mock).mockResolvedValue({ err: null, data: [] });
    await expect(getCompiledPrompt(validInput as any)).rejects.toThrow('No prompt');
  });

  it('calls getSpecificPrompt with id, name, version from input', async () => {
    await getCompiledPrompt(validInput as any);
    expect(getSpecificPrompt).toHaveBeenCalledWith(
      { id: 'p1', name: 'my-prompt', version: '1.0.0' },
      'db-1'
    );
  });

  it('handles empty variables object gracefully', async () => {
    const result = await getCompiledPrompt({ ...validInput, variables: {} } as any);
    expect(result.compiledPrompt).toBe('Hello {{name}}, your role is {{role}}');
  });
});
