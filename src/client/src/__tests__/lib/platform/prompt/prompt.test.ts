jest.mock('@/lib/platform/common', () => ({
  dataCollector: jest.fn(),
}));
jest.mock('@/lib/platform/prompt/table-details', () => ({
  OPENLIT_PROMPTS_TABLE_NAME: 'openlit_prompts',
  OPENLIT_PROMPT_VERSIONS_TABLE_NAME: 'openlit_prompt_versions',
  OPENLIT_PROMPT_VERSION_DOWNLOADS_TABLE_NAME: 'openlit_prompt_version_downloads',
}));
jest.mock('@/lib/session', () => ({
  getCurrentUser: jest.fn(),
}));
jest.mock('@/utils/error', () => ({
  throwIfError: jest.fn((condition: boolean, msg: string) => {
    if (condition) throw new Error(msg);
  }),
}));
jest.mock('@/constants/messages', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    UNAUTHORIZED_USER: 'Unauthorized',
    PROMPT_NAME_TAKEN: 'Prompt name taken',
    PROMPT_NOT_CREATED: 'Prompt not created',
    VERSION_NOT_SAVED: 'Version not saved',
    VERSION_SAVED: 'Version saved!',
    DOWNLOAD_INFO_NOT_SAVED: 'Download info not saved',
  })),
}));
jest.mock('@/utils/sanitizer', () => ({
  __esModule: true,
  default: {
    sanitizeValue: jest.fn((v: string) => v),
    sanitizeObject: jest.fn((o: object) => o),
  },
}));
jest.mock('@/helpers/server/prompt', () => ({
  verifyPromptInput: jest.fn(() => ({ success: true })),
}));
jest.mock('@/utils/json', () => ({
  jsonStringify: jest.fn((v: unknown) => JSON.stringify(v)),
}));
jest.mock('@/utils/log', () => ({
  consoleLog: jest.fn(),
}));

import { getPromptByName, checkNameValidity } from '@/lib/platform/prompt/index';
import { upsertPromptVersion, updateDownloadDetails } from '@/lib/platform/prompt/version';
import { dataCollector } from '@/lib/platform/common';
import { getCurrentUser } from '@/lib/session';

beforeEach(() => {
  jest.clearAllMocks();
  (dataCollector as jest.Mock).mockResolvedValue({ data: [], err: null });
  (getCurrentUser as jest.Mock).mockResolvedValue({ id: 'u1', email: 'user@example.com' });
});

describe('getPromptByName', () => {
  it('queries by name and returns first record', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ data: [{ id: 'p1', name: 'my-prompt' }] });
    const result = await getPromptByName({ name: 'my-prompt' });
    expect(dataCollector).toHaveBeenCalledTimes(1);
    const { query } = (dataCollector as jest.Mock).mock.calls[0][0];
    expect(query).toContain("name='my-prompt'");
    expect(result).toEqual({ id: 'p1', name: 'my-prompt' });
  });

  it('returns undefined when not found', async () => {
    const result = await getPromptByName({ name: 'unknown' });
    expect(result).toBeUndefined();
  });
});

describe('checkNameValidity', () => {
  it('returns isValid=true when no existing prompt', async () => {
    const result = await checkNameValidity({ name: 'new-prompt' });
    expect(result.isValid).toBe(true);
  });

  it('returns isValid=false when prompt name exists', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ data: [{ id: 'p1' }] });
    const result = await checkNameValidity({ name: 'taken' });
    expect(result.isValid).toBe(false);
  });
});

describe('upsertPromptVersion', () => {
  it('creates a new version (insert path)', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: null, data: { query_id: 'qid-1' } });
    const result = await upsertPromptVersion({
      promptId: 'p1',
      version: '1.0.0',
      status: 'published',
      prompt: 'Hello {{name}}',
      tags: [],
      metaProperties: {},
    } as any);
    expect(dataCollector).toHaveBeenCalledTimes(1);
    const [params, mode] = (dataCollector as jest.Mock).mock.calls[0];
    expect(mode).toBe('insert');
    expect(params.table).toBe('openlit_prompt_versions');
    expect(result).toBe('Version saved!');
  });

  it('updates an existing version (update path)', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: null, data: { query_id: 'qid-1' } });
    await upsertPromptVersion({
      promptId: 'p1',
      versionId: 'v1',
      version: '1.0.1',
      status: 'published',
      prompt: 'Updated prompt',
      tags: [],
      metaProperties: {},
    } as any);
    const [{ query }, mode] = (dataCollector as jest.Mock).mock.calls[0];
    expect(mode).toBe('exec');
    expect(query).toContain('ALTER TABLE');
    expect(query).toContain("WHERE version_id = 'v1'");
  });

  it('throws when user is not authenticated', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    await expect(
      upsertPromptVersion({ promptId: 'p1' } as any)
    ).rejects.toThrow('Unauthorized');
  });

  it('throws when dataCollector fails (no query_id)', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: null, data: null });
    await expect(
      upsertPromptVersion({ promptId: 'p1' } as any)
    ).rejects.toThrow();
  });

  it('uses versionErr.toString() in error message when versionErr is a string (covers line 73)', async () => {
    // versionErr is a string → typeof versionErr?.toString === "function" → true → versionErr.toString() called
    (dataCollector as jest.Mock).mockResolvedValue({ err: 'Version DB error', data: null });
    await expect(
      upsertPromptVersion({ promptId: 'p1' } as any)
    ).rejects.toThrow('Version DB error');
  });

  it('uses versionErr.toString() in error message when versionErr is an Error object (covers line 73)', async () => {
    const err = new Error('Version object error');
    (dataCollector as jest.Mock).mockResolvedValue({ err, data: null });
    await expect(
      upsertPromptVersion({ promptId: 'p1' } as any)
    ).rejects.toThrow('Version object error');
  });
});

describe('updateDownloadDetails', () => {
  it('inserts download details and returns true', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: null, data: { query_id: 'qid-1' } });
    const result = await updateDownloadDetails({
      promptId: 'p1',
      versionId: 'v1',
      metaProperties: {},
      downloadSource: 'sdk',
    } as any);
    expect(result).toBe(true);
    const [params, mode] = (dataCollector as jest.Mock).mock.calls[0];
    expect(mode).toBe('insert');
    expect(params.table).toBe('openlit_prompt_version_downloads');
  });

  it('returns true even when dataCollector fails (just logs)', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: 'DB error', data: null });
    const result = await updateDownloadDetails({
      promptId: 'p1',
      versionId: 'v1',
    } as any);
    expect(result).toBe(true);
  });

  it('logs DOWNLOAD_INFO_NOT_SAVED when err is null but data has no query_id (covers line 105 fallback)', async () => {
    // err is falsy, data is null → err || getMessage().DOWNLOAD_INFO_NOT_SAVED
    (dataCollector as jest.Mock).mockResolvedValue({ err: null, data: null });
    const result = await updateDownloadDetails({
      promptId: 'p1',
      versionId: 'v1',
    } as any);
    expect(result).toBe(true);
  });
});
