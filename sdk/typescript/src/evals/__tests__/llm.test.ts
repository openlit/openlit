import { llmResponseOpenAI, llmResponseAnthropic } from '../llm';

describe('llm', () => {
  it('llmResponseOpenAI throws if no apiKey', async () => {
    await expect(llmResponseOpenAI({ prompt: 'p', model: 'm', apiKey: undefined, baseUrl: undefined })).rejects.toThrow();
  });
  it('llmResponseAnthropic throws if no apiKey', async () => {
    await expect(llmResponseAnthropic({ prompt: 'p', model: 'm', apiKey: undefined })).rejects.toThrow();
  });
});
