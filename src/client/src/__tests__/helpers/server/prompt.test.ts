import { verifyPromptInput, validatePromptCompiledInput } from '@/helpers/server/prompt';

describe('verifyPromptInput', () => {
  it('returns failure when name is empty', () => {
    const result = verifyPromptInput({ name: '', prompt: 'Hello' } as any);
    expect(result.success).toBe(false);
    expect(result.err).toMatch(/name/i);
  });

  it('returns failure when prompt is empty', () => {
    const result = verifyPromptInput({ name: 'MyPrompt', prompt: '' } as any);
    expect(result.success).toBe(false);
    expect(result.err).toMatch(/prompt/i);
  });

  it('returns success when both name and prompt are provided', () => {
    const result = verifyPromptInput({ name: 'MyPrompt', prompt: 'Say hello' } as any);
    expect(result.success).toBe(true);
    expect((result as any).err).toBeUndefined();
  });
});

describe('validatePromptCompiledInput', () => {
  it('returns failure when apiKey is missing', () => {
    const result = validatePromptCompiledInput({ id: 'abc' } as any);
    expect(result.success).toBe(false);
    expect(result.err).toMatch(/api key/i);
  });

  it('returns failure when both id and name are missing', () => {
    const result = validatePromptCompiledInput({ apiKey: 'key123' } as any);
    expect(result.success).toBe(false);
    expect(result.err).toMatch(/id and name/i);
  });

  it('returns success when apiKey and id are provided', () => {
    const result = validatePromptCompiledInput({ apiKey: 'key123', id: 'prompt-1' } as any);
    expect(result.success).toBe(true);
  });

  it('returns success when apiKey and name are provided', () => {
    const result = validatePromptCompiledInput({ apiKey: 'key123', name: 'my-prompt' } as any);
    expect(result.success).toBe(true);
  });

  it('returns success when apiKey, id, and name are all provided', () => {
    const result = validatePromptCompiledInput({
      apiKey: 'key123',
      id: 'prompt-1',
      name: 'my-prompt',
    } as any);
    expect(result.success).toBe(true);
  });
});
