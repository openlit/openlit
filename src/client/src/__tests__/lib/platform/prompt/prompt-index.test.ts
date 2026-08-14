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
    PROMPT_SAVED: 'Prompt saved!',
    PROMPT_NOT_CREATED: 'Prompt not created',
    VERSION_NOT_CREATED: 'Version not created',
    PROMPT_DELETED: 'Prompt deleted!',
    PROMPT_NOT_DELETED: 'Prompt not deleted',
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

import {
  createPrompt,
  getPrompts,
  getSpecificPrompt,
  getPromptDetails,
  deletePrompt,
} from '@/lib/platform/prompt/index';
import { dataCollector } from '@/lib/platform/common';
import { getCurrentUser } from '@/lib/session';
import { verifyPromptInput } from '@/helpers/server/prompt';

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------
const VALID_PROMPT_INPUT = {
  name: 'my-prompt',
  prompt: 'Hello {{name}}',
  version: '1.0.0',
  status: 'PUBLISHED' as const,
  tags: ['tag1'],
  metaProperties: { key: 'value' },
};

beforeEach(() => {
  jest.clearAllMocks();
  (dataCollector as jest.Mock).mockResolvedValue({ data: [], err: null });
  (getCurrentUser as jest.Mock).mockResolvedValue({ id: 'u1', email: 'user@example.com' });
});

// ===========================================================================
// createPrompt
// ===========================================================================
describe('createPrompt', () => {
  // Happy-path setup:
  //   call 1 → checkNameValidity → getPromptByName: data:[] (name available)
  //   call 2 → insert prompt: { err: null }
  //   call 3 → getPromptByName (after insert): data:[{ id:'p1', name:'my-prompt' }]
  //   call 4 → insert version: { err: null, data: { query_id: 'qid-1' } }
  function mockHappyPath() {
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ data: [], err: null })                            // 1. checkNameValidity
      .mockResolvedValueOnce({ err: null })                                      // 2. insert prompt
      .mockResolvedValueOnce({ data: [{ id: 'p1', name: 'my-prompt' }], err: null }) // 3. getPromptByName
      .mockResolvedValueOnce({ err: null, data: { query_id: 'qid-v1' } });      // 4. insert version
  }

  it('creates a prompt and returns promptId and success message', async () => {
    mockHappyPath();
    const result = await createPrompt(VALID_PROMPT_INPUT);
    expect(result).toEqual({ data: { promptId: 'p1' }, message: 'Prompt saved!' });
    expect(dataCollector).toHaveBeenCalledTimes(4);
  });

  it('calls getCurrentUser for auth check', async () => {
    mockHappyPath();
    await createPrompt(VALID_PROMPT_INPUT);
    expect(getCurrentUser).toHaveBeenCalledTimes(1);
  });

  it('sanitizes the input object', async () => {
    const Sanitizer = require('@/utils/sanitizer').default;
    mockHappyPath();
    await createPrompt(VALID_PROMPT_INPUT);
    expect(Sanitizer.sanitizeObject).toHaveBeenCalledWith(VALID_PROMPT_INPUT);
  });

  it('verifies prompt input shape via verifyPromptInput', async () => {
    mockHappyPath();
    await createPrompt(VALID_PROMPT_INPUT);
    expect(verifyPromptInput).toHaveBeenCalledWith(VALID_PROMPT_INPUT);
  });

  it('inserts prompt into openlit_prompts with correct values', async () => {
    mockHappyPath();
    await createPrompt(VALID_PROMPT_INPUT);
    // Call index 1 (0-based) is the prompt insert
    const [insertParams, mode] = (dataCollector as jest.Mock).mock.calls[1];
    expect(mode).toBe('insert');
    expect(insertParams.table).toBe('openlit_prompts');
    expect(insertParams.values[0]).toMatchObject({
      name: 'my-prompt',
      created_by: 'user@example.com',
    });
  });

  it('inserts version into openlit_prompt_versions with correct values', async () => {
    mockHappyPath();
    await createPrompt(VALID_PROMPT_INPUT);
    // Call index 3 is the version insert
    const [versionParams, mode] = (dataCollector as jest.Mock).mock.calls[3];
    expect(mode).toBe('insert');
    expect(versionParams.table).toBe('openlit_prompt_versions');
    expect(versionParams.values[0]).toMatchObject({
      prompt_id: 'p1',
      updated_by: 'user@example.com',
      version: '1.0.0',
      status: 'PUBLISHED',
      prompt: 'Hello {{name}}',
    });
  });

  it('throws UNAUTHORIZED_USER when no user is logged in', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    await expect(createPrompt(VALID_PROMPT_INPUT)).rejects.toThrow('Unauthorized');
    expect(dataCollector).not.toHaveBeenCalled();
  });

  it('throws when verifyPromptInput fails', async () => {
    (verifyPromptInput as jest.Mock).mockReturnValueOnce({ success: false, err: 'Name required' });
    await expect(createPrompt({ ...VALID_PROMPT_INPUT, name: '' })).rejects.toThrow('Name required');
    expect(dataCollector).not.toHaveBeenCalled();
  });

  it('throws PROMPT_NAME_TAKEN when prompt name already exists', async () => {
    // checkNameValidity finds an existing prompt
    (dataCollector as jest.Mock).mockResolvedValueOnce({ data: [{ id: 'existing', name: 'my-prompt' }] });
    await expect(createPrompt(VALID_PROMPT_INPUT)).rejects.toThrow('Prompt name taken');
    // Only 1 call made (the name check) — insert was never reached
    expect(dataCollector).toHaveBeenCalledTimes(1);
  });

  it('throws when prompt insert dataCollector returns an error', async () => {
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ data: [], err: null })         // checkNameValidity: available
      .mockResolvedValueOnce({ err: 'Insert error' });        // prompt insert fails
    await expect(createPrompt(VALID_PROMPT_INPUT)).rejects.toThrow('Insert error');
  });

  it('throws PROMPT_NOT_CREATED when getPromptByName returns no id after insert', async () => {
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ data: [], err: null })         // checkNameValidity
      .mockResolvedValueOnce({ err: null })                   // insert prompt succeeds
      .mockResolvedValueOnce({ data: [], err: null });        // getPromptByName: no record
    await expect(createPrompt(VALID_PROMPT_INPUT)).rejects.toThrow('Prompt not created');
  });

  it('throws VERSION_NOT_CREATED when version insert returns no query_id', async () => {
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ data: [], err: null })
      .mockResolvedValueOnce({ err: null })
      .mockResolvedValueOnce({ data: [{ id: 'p1', name: 'my-prompt' }], err: null })
      .mockResolvedValueOnce({ err: null, data: null }); // no query_id
    await expect(createPrompt(VALID_PROMPT_INPUT)).rejects.toThrow('Version not created');
  });

  it('throws VERSION_NOT_CREATED with version error message when version insert returns an error', async () => {
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ data: [], err: null })
      .mockResolvedValueOnce({ err: null })
      .mockResolvedValueOnce({ data: [{ id: 'p1', name: 'my-prompt' }], err: null })
      .mockResolvedValueOnce({ err: 'Version DB error', data: null });
    await expect(createPrompt(VALID_PROMPT_INPUT)).rejects.toThrow('Version DB error');
  });

  it('returns promptId from the fetched prompt record', async () => {
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ data: [], err: null })
      .mockResolvedValueOnce({ err: null })
      .mockResolvedValueOnce({ data: [{ id: 'prompt-abc', name: 'my-prompt' }], err: null })
      .mockResolvedValueOnce({ err: null, data: { query_id: 'qid-1' } });
    const result = await createPrompt(VALID_PROMPT_INPUT);
    expect(result.data.promptId).toBe('prompt-abc');
  });
});

// ===========================================================================
// getPrompts
// ===========================================================================
describe('getPrompts', () => {
  it('returns dataCollector result', async () => {
    const mockData = [{ promptId: 'p1', name: 'my-prompt', totalVersions: 2 }];
    (dataCollector as jest.Mock).mockResolvedValue({ data: mockData, err: null });
    const result = await getPrompts();
    expect(result).toEqual({ data: mockData, err: null });
  });

  it('calls dataCollector exactly once with a SELECT query', async () => {
    await getPrompts();
    expect(dataCollector).toHaveBeenCalledTimes(1);
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).toContain('SELECT');
  });

  it('queries from openlit_prompts table', async () => {
    await getPrompts();
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).toContain('openlit_prompts');
  });

  it('joins with openlit_prompt_versions and openlit_prompt_version_downloads', async () => {
    await getPrompts();
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).toContain('openlit_prompt_versions');
    expect(query).toContain('openlit_prompt_version_downloads');
  });

  it('orders results by created_at DESC', async () => {
    await getPrompts();
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).toContain('created_at DESC');
  });

  it('calls getCurrentUser for auth check', async () => {
    await getPrompts();
    expect(getCurrentUser).toHaveBeenCalledTimes(1);
  });

  it('throws UNAUTHORIZED_USER when no user is logged in', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    await expect(getPrompts()).rejects.toThrow('Unauthorized');
    expect(dataCollector).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// getSpecificPrompt
// ===========================================================================
describe('getSpecificPrompt', () => {
  it('calls dataCollector with a SELECT query', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ data: [{ promptId: 'p1' }], err: null });
    await getSpecificPrompt({ id: 'p1' });
    expect(dataCollector).toHaveBeenCalledTimes(1);
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).toContain('SELECT');
  });

  it('adds id condition to WHERE clause when id is provided', async () => {
    await getSpecificPrompt({ id: 'prompt-1' });
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).toContain("p.id = 'prompt-1'");
  });

  it('adds name condition to WHERE clause when name is provided', async () => {
    await getSpecificPrompt({ name: 'my-prompt' });
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).toContain("p.name = 'my-prompt'");
  });

  it('adds version condition to WHERE clause when version is provided', async () => {
    await getSpecificPrompt({ version: '2.0.0' });
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).toContain("v.version = '2.0.0'");
  });

  it('combines multiple conditions with AND', async () => {
    await getSpecificPrompt({ name: 'my-prompt', version: '1.0.0' });
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).toContain("p.name = 'my-prompt'");
    expect(query).toContain("v.version = '1.0.0'");
    expect(query).toContain('AND');
  });

  it('queries from openlit_prompts joined with openlit_prompt_versions', async () => {
    await getSpecificPrompt({ id: 'p1' });
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).toContain('openlit_prompts');
    expect(query).toContain('openlit_prompt_versions');
  });

  it('orders by version DESC', async () => {
    await getSpecificPrompt({ id: 'p1' });
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).toContain('v.version DESC');
  });

  it('uses "query" mode when calling dataCollector', async () => {
    await getSpecificPrompt({ id: 'p1' });
    const [, mode] = (dataCollector as jest.Mock).mock.calls[0];
    expect(mode).toBe('query');
  });

  it('forwards dbConfigId as third argument to dataCollector', async () => {
    await getSpecificPrompt({ id: 'p1' }, 'db-cfg-99');
    const [, , dbConfigId] = (dataCollector as jest.Mock).mock.calls[0];
    expect(dbConfigId).toBe('db-cfg-99');
  });

  it('sanitizes the input parameters', async () => {
    const Sanitizer = require('@/utils/sanitizer').default;
    await getSpecificPrompt({ id: 'p1', name: 'test' });
    expect(Sanitizer.sanitizeObject).toHaveBeenCalledWith({ id: 'p1', name: 'test' });
  });

  it('does NOT call getCurrentUser (no auth required)', async () => {
    await getSpecificPrompt({ id: 'p1' });
    expect(getCurrentUser).not.toHaveBeenCalled();
  });

  it('returns raw dataCollector result', async () => {
    const mockResult = { data: [{ promptId: 'p1', name: 'my-prompt', prompt: 'Hi!' }], err: null };
    (dataCollector as jest.Mock).mockResolvedValue(mockResult);
    const result = await getSpecificPrompt({ id: 'p1' });
    expect(result).toEqual(mockResult);
  });
});

// ===========================================================================
// getPromptDetails
// ===========================================================================
describe('getPromptDetails', () => {
  // getPromptDetails runs Promise.all with two dataCollector calls.
  function mockBothQueries(
    versionDataResult: object,
    versionsListResult: object
  ) {
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce(versionDataResult)
      .mockResolvedValueOnce(versionsListResult);
  }

  it('calls dataCollector twice (via Promise.all)', async () => {
    mockBothQueries(
      { data: [{ promptId: 'p1', name: 'test', prompt: 'Hello' }], err: null },
      { data: [{ versionId: 'v1', version: '1.0.0' }], err: null }
    );
    await getPromptDetails('p1');
    expect(dataCollector).toHaveBeenCalledTimes(2);
  });

  it('calls getCurrentUser for auth check', async () => {
    mockBothQueries({ data: [], err: null }, { data: [], err: null });
    await getPromptDetails('p1');
    expect(getCurrentUser).toHaveBeenCalledTimes(1);
  });

  it('throws UNAUTHORIZED_USER when no user', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    await expect(getPromptDetails('p1')).rejects.toThrow('Unauthorized');
    expect(dataCollector).not.toHaveBeenCalled();
  });

  it('returns combined data with versions list attached to first record', async () => {
    const versionRecord = { promptId: 'p1', name: 'my-prompt', prompt: 'Hi!', version: '1.0.0' };
    const versionsList = [
      { versionId: 'v1', version: '1.0.0', status: 'PUBLISHED' },
      { versionId: 'v2', version: '2.0.0', status: 'DRAFT' },
    ];
    mockBothQueries(
      { data: [versionRecord], err: null },
      { data: versionsList, err: null }
    );
    const result = await getPromptDetails('p1');
    expect(result.data[0]).toMatchObject({ promptId: 'p1', name: 'my-prompt' });
    expect(result.data[0].versions).toEqual(versionsList);
  });

  it('returns { data: [null], err: null } when versionData has no records', async () => {
    mockBothQueries(
      { data: [], err: null },
      { data: [{ versionId: 'v1' }], err: null }
    );
    const result = await getPromptDetails('p1');
    expect(result.data[0]).toBeNull();
    expect(result.err).toBeNull();
  });

  it('returns err from versionData when first query fails', async () => {
    mockBothQueries(
      { data: null, err: 'Version query failed' },
      { data: [], err: null }
    );
    const result = await getPromptDetails('p1');
    expect(result.err).toBe('Version query failed');
  });

  it('returns err from versionsList when second query fails', async () => {
    mockBothQueries(
      { data: [{ promptId: 'p1', name: 'test' }], err: null },
      { data: null, err: 'Versions list failed' }
    );
    const result = await getPromptDetails('p1');
    expect(result.err).toBe('Versions list failed');
  });

  it('includes promptId in both dataCollector queries', async () => {
    mockBothQueries({ data: [], err: null }, { data: [], err: null });
    await getPromptDetails('prompt-xyz');
    const [firstCall] = (dataCollector as jest.Mock).mock.calls[0];
    const [secondCall] = (dataCollector as jest.Mock).mock.calls[1];
    expect(firstCall.query).toContain('prompt-xyz');
    expect(secondCall.query).toContain('prompt-xyz');
  });

  it('both calls use "query" mode', async () => {
    mockBothQueries({ data: [], err: null }, { data: [], err: null });
    await getPromptDetails('p1');
    expect((dataCollector as jest.Mock).mock.calls[0][1]).toBe('query');
    expect((dataCollector as jest.Mock).mock.calls[1][1]).toBe('query');
  });

  it('applies version filter in first query when version parameter is provided', async () => {
    mockBothQueries({ data: [], err: null }, { data: [], err: null });
    await getPromptDetails('p1', { version: '2.0.0' });
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).toContain("version='2.0.0'");
    expect(query).toContain("status != 'DRAFT'");
  });

  it('does not apply version filter when no version parameter is given', async () => {
    mockBothQueries({ data: [], err: null }, { data: [], err: null });
    await getPromptDetails('p1');
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).not.toContain("status != 'DRAFT'");
  });

  it('sets versions to empty array when versionsList data is null', async () => {
    const versionRecord = { promptId: 'p1', name: 'my-prompt', prompt: 'Hi!' };
    mockBothQueries(
      { data: [versionRecord], err: null },
      { data: null, err: null }
    );
    const result = await getPromptDetails('p1');
    expect(result.data[0].versions).toEqual([]);
  });

  it('sanitizes the parameters object', async () => {
    const Sanitizer = require('@/utils/sanitizer').default;
    mockBothQueries({ data: [], err: null }, { data: [], err: null });
    await getPromptDetails('p1', { version: '1.0.0' });
    expect(Sanitizer.sanitizeObject).toHaveBeenCalledWith({ version: '1.0.0' });
  });
});

// ===========================================================================
// deletePrompt
// ===========================================================================
describe('deletePrompt', () => {
  it('returns [undefined, success message] when all three deletes succeed', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: null });
    const result = await deletePrompt('p1');
    expect(result).toEqual([undefined, 'Prompt deleted!']);
  });

  it('calls dataCollector three times via Promise.all', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: null });
    await deletePrompt('p1');
    expect(dataCollector).toHaveBeenCalledTimes(3);
  });

  it('deletes from openlit_prompts with the correct id', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: null });
    await deletePrompt('prompt-id-1');
    const promptDeleteCall = (dataCollector as jest.Mock).mock.calls.find(([{ query }]) =>
      query.includes('openlit_prompts') && !query.includes('openlit_prompt_versions')
    );
    expect(promptDeleteCall).toBeDefined();
    expect(promptDeleteCall[0].query).toContain("WHERE id = 'prompt-id-1'");
  });

  it('deletes from openlit_prompt_versions with prompt_id', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: null });
    await deletePrompt('prompt-id-1');
    const versionDeleteCall = (dataCollector as jest.Mock).mock.calls.find(([{ query }]) =>
      query.includes('openlit_prompt_versions') && !query.includes('openlit_prompt_version_downloads')
    );
    expect(versionDeleteCall).toBeDefined();
    expect(versionDeleteCall[0].query).toContain("WHERE prompt_id = 'prompt-id-1'");
  });

  it('deletes from openlit_prompt_version_downloads with prompt_id', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: null });
    await deletePrompt('prompt-id-1');
    const downloadsDeleteCall = (dataCollector as jest.Mock).mock.calls.find(([{ query }]) =>
      query.includes('openlit_prompt_version_downloads')
    );
    expect(downloadsDeleteCall).toBeDefined();
    expect(downloadsDeleteCall[0].query).toContain("WHERE prompt_id = 'prompt-id-1'");
  });

  it('uses "exec" mode for all dataCollector calls', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: null });
    await deletePrompt('p1');
    for (const call of (dataCollector as jest.Mock).mock.calls) {
      expect(call[1]).toBe('exec');
    }
  });

  it('returns [PROMPT_NOT_DELETED] when any delete fails', async () => {
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ err: null })
      .mockResolvedValueOnce({ err: 'DB error' })
      .mockResolvedValueOnce({ err: null });
    const result = await deletePrompt('p1');
    expect(result).toEqual(['Prompt not deleted']);
  });

  it('returns [PROMPT_NOT_DELETED] when all deletes fail', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: 'Connection refused' });
    const result = await deletePrompt('p1');
    expect(result).toEqual(['Prompt not deleted']);
  });

  it('returns [PROMPT_NOT_DELETED] when only the first delete fails', async () => {
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ err: 'First error' })
      .mockResolvedValueOnce({ err: null })
      .mockResolvedValueOnce({ err: null });
    const result = await deletePrompt('p1');
    expect(result).toEqual(['Prompt not deleted']);
  });

  it('throws UNAUTHORIZED_USER when no user is logged in', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    await expect(deletePrompt('p1')).rejects.toThrow('Unauthorized');
    expect(dataCollector).not.toHaveBeenCalled();
  });

  it('sanitizes the promptId parameter', async () => {
    const Sanitizer = require('@/utils/sanitizer').default;
    (dataCollector as jest.Mock).mockResolvedValue({ err: null });
    await deletePrompt('  p1  ');
    expect(Sanitizer.sanitizeValue).toHaveBeenCalledWith('  p1  ');
  });

  it('calls getCurrentUser once for auth', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: null });
    await deletePrompt('p1');
    expect(getCurrentUser).toHaveBeenCalledTimes(1);
  });

  it('all DELETE queries contain DELETE FROM keyword', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: null });
    await deletePrompt('p1');
    for (const [{ query }] of (dataCollector as jest.Mock).mock.calls) {
      expect(query.toUpperCase()).toContain('DELETE FROM');
    }
  });
});
