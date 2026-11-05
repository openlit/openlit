const mockCreate = jest.fn();

jest.mock(
  '@anthropic-ai/sdk',
  () => ({
    default: class {
      messages = { create: mockCreate };
    },
  }),
  { virtual: true }
);

import { llmResponseAnthropic } from '../anthropic';

describe('llmResponseAnthropic', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: '{"verdict":"yes"}' }] });
  });

  it('falls back to a current Claude model when none is given', async () => {
    await llmResponseAnthropic({ prompt: 'check this', apiKey: 'test-key' });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    // claude-3-opus-20240229 was retired on 2026-01-05, so a call that falls back to it fails.
    expect(mockCreate.mock.calls[0][0].model).toBe('claude-sonnet-4-6');
  });

  it('sends the model the caller passes', async () => {
    await llmResponseAnthropic({ prompt: 'check this', model: 'claude-haiku-4-5', apiKey: 'test-key' });

    expect(mockCreate.mock.calls[0][0].model).toBe('claude-haiku-4-5');
  });
});
